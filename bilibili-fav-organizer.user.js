// ==UserScript==
// @name         B站 AI 收藏夹自动整理 (V9.0 DeepSeek适配版)
// @namespace    http://tampermonkey.net/
// @version      9.0.0
// @description  使用 DeepSeek AI 自动整理B站收藏夹，支持预览模式、多API适配
// @author       基于"某不知名的根号三"V8.1改编
// @match        https://space.bilibili.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // =============================================
    // 配置区 —— 只需改这里
    // =============================================
    const CONFIG = {
        // DeepSeek API 配置（默认）
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
        apiKey: 'sk-把你的DeepSeek_API_Key填在这里', // 必填！获取地址: platform.deepseek.com
        model: 'deepseek-v4-flash', // DeepSeek V4 Flash
        temperature: 0.1, // 越低越稳定，分类任务建议 0.1

        // 其他兼容 OpenAI 格式的 API 示例（取消注释即可切换）：
        // apiUrl: 'https://api.openai.com/v1/chat/completions',
        // apiKey: 'sk-xxx',
        // model: 'gpt-4o',
    };

    // 如果之前用 GM_setValue 存过 API Key，优先使用存储的值
    const STORED_KEY = GM_getValue('bili_ai_api_key', '');
    if (STORED_KEY && CONFIG.apiKey.includes('把你')) {
        CONFIG.apiKey = STORED_KEY;
    }
    // =============================================

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ========== UI 工具 ==========
    function logStatus(msg, type = 'info') {
        const colors = { info: '#333', success: '#2e7d32', error: '#c62828', warn: '#e65100', ai: '#6a1b9a' };
        const icons = { info: '➜', success: '✅', error: '❌', warn: '⚠️', ai: '🧠' };
        console.log(`[BiliAI] ${msg}`);
        const logDiv = document.getElementById('ai-status-log');
        if (logDiv) {
            const color = colors[type] || colors.info;
            const icon = icons[type] || icons.info;
            logDiv.innerHTML += `<div style="margin-top:4px;color:${color};">${icon} ${msg}</div>`;
            logDiv.scrollTop = logDiv.scrollHeight;
        }
    }

    // ========== B站数据获取 ==========
    function getBiliAuth() {
        const midMatch = document.cookie.match(/DedeUserID=([^;]+)/);
        const csrfMatch = document.cookie.match(/bili_jct=([^;]+)/);
        return { mid: midMatch ? midMatch[1] : '', csrf: csrfMatch ? csrfMatch[1] : '' };
    }

    function getSourceMediaId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('fid') || params.get('media_id') || params.get('id');
    }

    function getCurrentFolderName() {
        // 尝试从页面获取当前收藏夹名称
        const el = document.querySelector('.fav-folder-title, .folder-title, h1.title');
        return el ? el.textContent.trim() : '';
    }

    // ========== B站 API 操作 ==========
    async function apiGet(url) {
        const res = await fetch(url, { credentials: 'include' }).then(r => r.json());
        if (res.code !== 0) throw new Error(`API错误(${res.code}): ${res.message}`);
        return res.data;
    }

    async function apiPost(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body).toString()
        }).then(r => r.json());
        if (res.code !== 0) throw new Error(`API错误(${res.code}): ${res.message}`);
        return res.data;
    }

    // 获取所有收藏夹（过滤默认收藏夹）
    async function getMyFolders(mid) {
        const data = await apiGet(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
        const folderMap = {};
        if (data.list) {
            data.list.forEach(f => {
                if (f.title !== '默认收藏夹') folderMap[f.title] = f.id;
            });
        }
        // 如果还有其他方式获取的收藏夹（如收藏的合集），也加入
        if (data.count === 0) {
            // 尝试获取收藏的合集列表
            try {
                const collData = await apiGet(`https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid=${mid}`);
                if (collData.list) {
                    collData.list.forEach(f => {
                        if (f.title !== '默认收藏夹' && !folderMap[f.title]) {
                            folderMap[f.title] = f.id;
                        }
                    });
                }
            } catch (e) { /* 忽略 */ }
        }
        return folderMap;
    }

    // 分页获取当前收藏夹所有视频
    async function fetchAllVideos(sourceMediaId) {
        let allVideos = [];
        let pn = 1;
        const ps = 20;

        while (true) {
            logStatus(`正在读取第 ${pn} 页...`);
            const url = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${sourceMediaId}&pn=${pn}&ps=${ps}&platform=web`;
            const data = await apiGet(url);
            const videos = data.medias || [];
            if (videos.length === 0) break;

            allVideos.push(...videos);
            if (videos.length < ps) break;

            pn++;
            await sleep(300); // 避免请求过快
        }
        return allVideos;
    }

    // 创建收藏夹
    async function createFolder(title, csrf) {
        logStatus(`正在创建收藏夹：【${title}】`, 'warn');
        const data = await apiPost('https://api.bilibili.com/x/v3/fav/folder/add', {
            title: title,
            privacy: 1, // 私密
            csrf: csrf
        });
        logStatus(`收藏夹【${title}】创建成功`, 'success');
        return data.id;
    }

    // 批量移动视频
    async function moveVideos(srcMediaId, tarMediaId, resources, auth) {
        const resourcesStr = resources.map(v => `${v.id}:${v.type}`).join(',');
        await apiPost('https://api.bilibili.com/x/v3/fav/resource/move', {
            src_media_id: srcMediaId,
            tar_media_id: tarMediaId,
            mid: auth.mid,
            resources: resourcesStr,
            csrf: auth.csrf
        });
    }

    // 获取收藏夹中的视频数量（用于统计）
    async function getFolderMediaCount(mediaId) {
        try {
            const data = await apiGet(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=1&ps=1&platform=web`);
            return data.has_more !== undefined ? (data.page ? data.page.total_count || 0 : 0) : 0;
        } catch (e) {
            return '?';
        }
    }

    // ========== AI 分类 ==========
    function buildAIPrompt(videoData, existingFolderNames, userRequirement) {
        const folderList = existingFolderNames.length > 0
            ? existingFolderNames.join('、')
            : '暂无';

        const customRule = userRequirement ? `

【⭐ 用户特殊要求（最高优先级）⭐】
${userRequirement}

重要：如果用户要求中提到了某个分类，必须优先在【已有收藏夹】中找到最匹配的名称（允许模糊匹配），绝不允许新建近义词分类！` : '';

        return `你是一个严格的视频分类专家。请对以下B站视频进行智能分类。

【已有收藏夹】
${folderList}

【分类规则 - 必须严格遵守】
1. 优先匹配已有收藏夹：只要视频内容与某个已有收藏夹沾边，就必须使用该收藏夹的「准确名称」（一字不差）
2. 谨慎新建：只有当视频确实与所有已有收藏夹都不相关时，才能创建新的大类（≥2个视频才建新分类）
3. 绝不遗漏：每个视频都必须被分类，不允许漏掉任何一个
4. 分类粒度适中：不要分得太细（如每个视频一个分类），也不要太粗（全部塞进一个分类）
5. 名称规范：新分类名称应简洁明了（2-6个字），如"前端开发""机器学习""游戏实况"${customRule}

【输出格式】
严格输出纯JSON，包含 thoughts 和 categories 两个字段：
{
  "thoughts": "你的分析过程（简短说明分类逻辑）",
  "categories": {
    "收藏夹名称1": [{"id": 视频ID, "type": 视频类型}],
    "收藏夹名称2": [{"id": 视频ID, "type": 视频类型}]
  }
}

【待分类视频】
${JSON.stringify(videoData)}`;
    }

    // 分批处理的 Prompt（更轻量）
    function buildBatchPrompt(videoData, existingFolderNames, userRequirement, batchNum, totalBatches) {
        const folderList = existingFolderNames.length > 0
            ? existingFolderNames.join('、')
            : '暂无';

        const customRule = userRequirement ? `

【⭐ 用户特殊要求（最高优先级）⭐】
${userRequirement}

重要：如果用户要求中提到了某个分类，必须优先在【已有收藏夹】中找到最匹配的名称（允许模糊匹配），绝不允许新建近义词分类！` : '';

        return `你是视频分类专家。这是第 ${batchNum}/${totalBatches} 批视频，请分类。

【已有收藏夹（含前几批已创建的）】
${folderList}

【规则】
1. 优先匹配已有收藏夹「准确名称」（一字不差）
2. 仅当完全不相关时才能建新分类（≥2个视频）
3. 每个视频必须分类，名称简洁（2-6字）${customRule}

【输出严格JSON】
{"thoughts":"简短分析","categories":{"分类名":[{"id":视频ID,"type":视频类型}]}}

【本批视频】
${JSON.stringify(videoData)}`;
    }

    function callAI(prompt) {
        return new Promise((resolve, reject) => {
            logStatus(`正在调用 ${CONFIG.model} 进行智能分类...`, 'ai');

            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.apiUrl,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CONFIG.apiKey}`
                },
                data: JSON.stringify({
                    model: CONFIG.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: CONFIG.temperature,
                    max_tokens: 65536
                }),
                timeout: 120000, // 2分钟超时
                onload: function (response) {
                    if (response.status !== 200) {
                        let errMsg = `API返回状态码 ${response.status}`;
                        try {
                            const err = JSON.parse(response.responseText);
                            errMsg = err.error?.message || errMsg;
                        } catch (e) { }
                        reject(new Error(errMsg));
                        return;
                    }
                    let content;
                    try {
                        const data = JSON.parse(response.responseText);
                        if (!data.choices || !data.choices[0]) {
                            reject(new Error('API返回格式异常'));
                            return;
                        }
                        content = data.choices[0].message.content;
                        // 清理可能的markdown包裹
                        content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                        const result = JSON.parse(content);
                        resolve(result);
                    } catch (e) {
                        console.error('[BiliAI] 原始返回:', content);
                        reject(new Error('AI返回内容解析失败: ' + e.message + '（查看控制台获取原始内容）'));
                    }
                },
                onerror: function (err) {
                    reject(new Error('网络请求失败，请检查网络或API地址'));
                },
                ontimeout: function () {
                    reject(new Error('AI请求超时（>2分钟），收藏夹视频太多或API响应慢'));
                }
            });
        });
    }

    // ========== 主流程 ==========
    async function startProcess(previewOnly = false) {
        const auth = getBiliAuth();
        const sourceMediaId = getSourceMediaId();
        const folderName = getCurrentFolderName();
        const customPromptInput = document.getElementById('ai-custom-prompt');
        const userRequirement = customPromptInput ? customPromptInput.value.trim() : '';

        // 验证
        if (!auth.mid || !auth.csrf) {
            alert('请确保你已登录B站！\n如果已登录，请刷新页面后重试。');
            return;
        }
        if (!sourceMediaId) {
            alert('未能识别当前收藏夹ID！\n请在某个具体收藏夹页面内运行（URL中包含 ?fid=xxx）。');
            return;
        }
        if (CONFIG.apiKey.includes('把你') || CONFIG.apiKey.length < 10) {
            alert('请先在脚本中配置你的 DeepSeek API Key！\n打开 Tampermonkey → 编辑此脚本 → 修改 apiKey。');
            return;
        }

        const btn = document.getElementById('ai-start-btn');
        const previewBtn = document.getElementById('ai-preview-btn');
        btn.disabled = true;
        if (previewBtn) previewBtn.disabled = true;

        updateButtonState('running');

        const logDiv = document.getElementById('ai-status-log');
        logDiv.innerHTML = '';

        try {
            // Step 1: 获取已有收藏夹
            logStatus(`当前收藏夹：${folderName || '(未识别名称)'}`);
            logStatus('正在获取已有收藏夹列表...');
            const folderMap = await getMyFolders(auth.mid);
            const folderNames = Object.keys(folderMap);
            logStatus(`发现 ${folderNames.length} 个已有收藏夹`, 'success');

            if (folderNames.length > 0) {
                logStatus(`已有：${folderNames.slice(0, 10).join('、')}${folderNames.length > 10 ? '...等' : ''}`);
            }

            // Step 2: 抓取视频
            logStatus('开始抓取当前收藏夹视频...');
            const allVideos = await fetchAllVideos(sourceMediaId);

            if (allVideos.length === 0) {
                logStatus('当前收藏夹是空的！', 'warn');
                updateButtonState('reset');
                return;
            }

            logStatus(`共获取 ${allVideos.length} 个视频`, 'success');

            // Step 3: 分批AI分类
            const videoDataForAI = allVideos.map(v => ({
                id: v.id,
                type: v.type,
                title: v.title,
                intro: v.intro ? v.intro.substring(0, 50) : ''
            }));

            const BATCH_SIZE = 20;
            const totalBatches = Math.ceil(videoDataForAI.length / BATCH_SIZE);
            logStatus(`共 ${allVideos.length} 个视频，分 ${totalBatches} 批处理（每批 ${BATCH_SIZE} 个）`);

            // 合并所有批次的分类结果
            const categories = {}; // { 分类名: [videoObj...] }
            const allThoughts = [];
            let batchFailures = 0;

            for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
                const start = batchNum * BATCH_SIZE;
                const end = Math.min(start + BATCH_SIZE, videoDataForAI.length);
                const batchVideos = videoDataForAI.slice(start, end);

                // 把之前批次用过的分类名也传给AI，保持一致性
                const prevCatNames = Object.keys(categories);
                const knownFolders = [...new Set([...folderNames, ...prevCatNames])];

                const prompt = buildBatchPrompt(
                    batchVideos, knownFolders, userRequirement,
                    batchNum + 1, totalBatches
                );

                logStatus(`第 ${batchNum + 1}/${totalBatches} 批：${batchVideos.length} 个视频，调用AI...`, 'ai');

                let batchResult;
                try {
                    batchResult = await callAI(prompt);
                } catch (e) {
                    logStatus(`第 ${batchNum + 1}/${totalBatches} 批 AI 调用失败: ${e.message}`, 'error');
                    batchFailures++;
                    continue;
                }

                if (batchResult.thoughts) {
                    allThoughts.push(`[第${batchNum + 1}批] ${batchResult.thoughts}`);
                }

                // 合并分类结果
                const batchCats = batchResult.categories || {};
                for (const [catName, vids] of Object.entries(batchCats)) {
                    if (!vids || vids.length === 0) continue;
                    if (!categories[catName]) {
                        categories[catName] = [];
                    }
                    categories[catName].push(...vids);
                }

                logStatus(`第 ${batchNum + 1}/${totalBatches} 批完成，暂有 ${Object.keys(categories).length} 个分类`);
            }

            if (batchFailures > 0) {
                logStatus(`⚠️ ${batchFailures}/${totalBatches} 批处理失败，部分视频可能未被分类`, 'warn');
            }

            // 输出总体分析思路
            if (allThoughts.length > 0) {
                console.log('💡 AI分析过程:\n', allThoughts.join('\n'));
                logStatus(`AI思路摘要：${allThoughts[0].substring(0, 60)}...`, 'ai');
            }
            logStatus('AI分类全部完成！', 'success');

            // 统计分类结果
            const catCount = Object.keys(categories).length;
            let totalClassified = 0;
            Object.values(categories).forEach(v => { totalClassified += (v || []).length; });

            logStatus(`分为 ${catCount} 个类别，覆盖 ${totalClassified}/${allVideos.length} 个视频`);

            // 显示分类预览
            showCategoryPreview(categories, folderMap);

            if (previewOnly) {
                logStatus('--- 预览模式：以上为AI分类结果，未执行实际移动 ---', 'warn');
                logStatus('如需执行，请点击"开始整理"按钮', 'warn');
                updateButtonState('preview_done');
                return;
            }

            // Step 4: 执行移动
            logStatus('--- 开始执行移动操作 ---');
            let processedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;

            for (const [categoryName, vids] of Object.entries(categories)) {
                if (!vids || vids.length === 0) continue;

                // 检查目标是否就是当前收藏夹（避免自己移给自己）
                if (String(folderMap[categoryName]) === String(sourceMediaId)) {
                    logStatus(`跳过【${categoryName}】：目标与源收藏夹相同`, 'warn');
                    skippedCount += vids.length;
                    continue;
                }

                let targetFolderId = folderMap[categoryName];
                if (!targetFolderId) {
                    // 需要创建新收藏夹
                    try {
                        targetFolderId = await createFolder(categoryName, auth.csrf);
                        folderMap[categoryName] = targetFolderId;
                        await sleep(1000);
                    } catch (e) {
                        logStatus(`创建收藏夹【${categoryName}】失败: ${e.message}`, 'error');
                        errorCount += vids.length;
                        continue;
                    }
                }

                // 移动视频（分批，每批50个）
                const batchSize = 50;
                const batches = [];
                for (let i = 0; i < vids.length; i += batchSize) {
                    batches.push(vids.slice(i, i + batchSize));
                }

                logStatus(`正在将 ${vids.length} 个视频移入【${categoryName}】...`);

                for (const batch of batches) {
                    try {
                        await moveVideos(sourceMediaId, targetFolderId, batch, auth);
                        processedCount += batch.length;
                        await sleep(500);
                    } catch (e) {
                        logStatus(`移动【${categoryName}】部分视频失败: ${e.message}`, 'error');
                        errorCount += batch.length;
                    }
                }
            }

            // Step 5: 完成
            logStatus('');
            logStatus('🎉 整理完成！', 'success');
            logStatus(`成功移动: ${processedCount} 个 | 跳过: ${skippedCount} 个 | 失败: ${errorCount} 个`);
            if (processedCount > 0) {
                logStatus('请刷新页面查看整理后的收藏夹', 'info');
            }
            updateButtonState('done');

        } catch (error) {
            logStatus(`发生错误: ${error.message}`, 'error');
            console.error(error);
            updateButtonState('reset');
        }
    }

    // ========== 分类预览面板 ==========
    function showCategoryPreview(categories, folderMap) {
        const previewDiv = document.getElementById('ai-category-preview');
        if (!previewDiv) return;

        let html = '<div style="font-size:13px;font-weight:bold;margin-bottom:8px;">📋 分类预览：</div>';
        const existingFolders = new Set(Object.keys(folderMap));

        for (const [catName, vids] of Object.entries(categories)) {
            const count = vids ? vids.length : 0;
            const isNew = !existingFolders.has(catName);
            const badge = isNew
                ? '<span style="background:#ff9800;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px;">新建</span>'
                : '<span style="background:#4caf50;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px;">已有</span>';
            html += `<div style="font-size:12px;padding:3px 0;border-bottom:1px solid #eee;">
        ${badge} <b>${catName}</b>：${count} 个视频
      </div>`;
        }
        previewDiv.innerHTML = html;
        previewDiv.style.display = 'block';
    }

    function updateButtonState(state) {
        const btn = document.getElementById('ai-start-btn');
        const previewBtn = document.getElementById('ai-preview-btn');
        if (!btn) return;

        switch (state) {
            case 'running':
                btn.innerText = '🔄 整理中...';
                btn.style.background = '#999';
                btn.disabled = true;
                if (previewBtn) previewBtn.disabled = true;
                break;
            case 'reset':
                btn.innerText = '🚀 开始整理';
                btn.style.background = '#fb7299';
                btn.disabled = false;
                if (previewBtn) {
                    previewBtn.innerText = '👁 仅预览';
                    previewBtn.disabled = false;
                }
                break;
            case 'preview_done':
                btn.innerText = '🚀 确认执行整理';
                btn.style.background = '#fb7299';
                btn.disabled = false;
                if (previewBtn) {
                    previewBtn.innerText = '👁 重新预览';
                    previewBtn.style.background = '#ff9800';
                    previewBtn.disabled = false;
                }
                break;
            case 'done':
                btn.innerText = '✅ 完成，点我刷新';
                btn.style.background = '#4CAF50';
                btn.disabled = false;
                btn.onclick = () => window.location.reload();
                if (previewBtn) previewBtn.disabled = true;
                break;
        }
    }

    // ========== UI 构建 ==========
    function initUI() {
        if (document.getElementById('ai-sort-wrapper')) return;

        // 保存key的辅助函数
        function saveApiKey() {
            const input = document.getElementById('ai-apikey-input');
            if (input && input.value.trim()) {
                CONFIG.apiKey = input.value.trim();
                GM_setValue('bili_ai_api_key', input.value.trim());
                logStatus('API Key 已保存', 'success');
            }
        }

        // 浮动按钮
        const floatBtn = document.createElement('div');
        floatBtn.id = 'ai-float-btn';
        floatBtn.innerHTML = '🤖<br>AI整理';
        floatBtn.title = 'AI整理收藏夹';
        Object.assign(floatBtn.style, {
            position: 'fixed', bottom: '100px', left: '30px', zIndex: 9999,
            background: '#fb7299', color: 'white', width: '54px', height: '54px',
            borderRadius: '27px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(251, 114, 153, 0.5)', transition: 'all 0.3s',
            userSelect: 'none'
        });

        floatBtn.addEventListener('mouseenter', () => {
            floatBtn.style.transform = 'scale(1.1)';
        });
        floatBtn.addEventListener('mouseleave', () => {
            floatBtn.style.transform = 'scale(1)';
        });

        // 面板
        const panel = document.createElement('div');
        panel.id = 'ai-sort-wrapper';
        Object.assign(panel.style, {
            position: 'fixed', bottom: '30px', left: '30px', zIndex: 10000,
            width: '360px', display: 'none', flexDirection: 'column',
            boxShadow: '0 8px 30px rgba(0,0,0,0.25)', borderRadius: '12px',
            overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif',
            maxHeight: '80vh'
        });

        const needApiKey = CONFIG.apiKey.includes('把你') || CONFIG.apiKey.length < 10;

        panel.innerHTML = `
      <div style="background:linear-gradient(135deg, #fb7299, #ff6b8a); color:#fff; padding:14px 16px; font-weight:bold; font-size:15px; display:flex; justify-content:space-between; align-items:center;">
        <span>🤖 AI 收藏夹整理</span>
        <span id="ai-close-btn" style="cursor:pointer; font-size:20px; line-height:1; opacity:0.7;">×</span>
      </div>
      <div style="background:#fff; padding:16px; border:1px solid #eee; border-top:none;">
        ${needApiKey ? `
        <div style="background:#fff3e0;padding:10px;border-radius:6px;margin-bottom:12px;font-size:12px;color:#e65100;">
          ⚠️ 请先填写 DeepSeek API Key
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">API Key（从 platform.deepseek.com 获取）</label>
          <div style="display:flex;gap:6px;">
            <input id="ai-apikey-input" type="password" placeholder="sk-xxxxxxxx" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none;">
            <button id="ai-save-key-btn" style="padding:8px 12px;background:#4caf50;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;">保存</button>
          </div>
        </div>
        ` : ''}
        <p style="margin:0 0 6px 0; font-size:13px; color:#666;">整理要求 <span style="color:#999;">(选填)</span></p>
        <textarea id="ai-custom-prompt" placeholder="例如：&#10;- Vue/React 相关统一放「前端框架」&#10;- 算法题解放「算法与数据结构」&#10;- 不确定的放「待复核」&#10;- 分类不要太细" style="width:100%;height:80px;padding:10px;box-sizing:border-box;border:1px solid #ddd;border-radius:8px;font-size:13px;resize:none;margin-bottom:12px;outline:none;font-family:inherit;"></textarea>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button id="ai-preview-btn" style="flex:1;padding:10px;background:#ff9800;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;transition:opacity 0.2s;">👁 仅预览</button>
          <button id="ai-start-btn" style="flex:1;padding:10px;background:#fb7299;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;transition:opacity 0.2s;">🚀 开始整理</button>
        </div>
        <div id="ai-category-preview" style="display:none;background:#f8f9fa;padding:10px;border-radius:8px;margin-bottom:10px;max-height:200px;overflow-y:auto;font-size:12px;"></div>
        <div id="ai-status-log" style="background:#f4f4f4;padding:10px;border-radius:8px;font-size:12px;color:#333;height:150px;overflow-y:auto;word-break:break-all;line-height:1.5;">
          等待指令...
        </div>
        <div style="margin-top:10px;font-size:11px;color:#999;text-align:center;">
          模型：deepseek-v4-flash | Temp：${CONFIG.temperature}
        </div>
      </div>
    `;

        document.body.appendChild(floatBtn);
        document.body.appendChild(panel);

        // 事件绑定
        floatBtn.onclick = () => {
            floatBtn.style.display = 'none';
            panel.style.display = 'flex';
        };

        document.getElementById('ai-close-btn').onclick = () => {
            panel.style.display = 'none';
            floatBtn.style.display = 'flex';
        };

        // 保存 API Key
        const saveKeyBtn = document.getElementById('ai-save-key-btn');
        if (saveKeyBtn) {
            saveKeyBtn.onclick = () => {
                saveApiKey();
                saveKeyBtn.innerText = '已保存';
                saveKeyBtn.style.background = '#999';
                setTimeout(() => {
                    saveKeyBtn.innerText = '保存';
                    saveKeyBtn.style.background = '#4caf50';
                }, 2000);
            };
        }

        // API Key输入框回车也可保存
        const apiKeyInput = document.getElementById('ai-apikey-input');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveApiKey();
            });
        }

        // 预览按钮
        const previewBtn = document.getElementById('ai-preview-btn');
        if (previewBtn) {
            previewBtn.onclick = () => {
                // 先保存key（如果有输入）
                if (apiKeyInput && apiKeyInput.value.trim()) saveApiKey();
                startProcess(true);
            };
        }

        // 开始按钮
        const startBtn = document.getElementById('ai-start-btn');
        startBtn.onclick = () => {
            if (apiKeyInput && apiKeyInput.value.trim()) saveApiKey();
            startProcess(false);
        };
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

})();

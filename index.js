// index.js - SillyTavern Writer Mode Extension
// 科幻风格全屏作家模式 - 连环画版（纯JS实现）

let context;
let overlay = null;
let textarea = null;
let isGenerating = false;
let abortController = null;

// 连环画模式相关状态
let storyMode = {
    enabled: false,           // 连环画模式开关
    autoBind: true,          // 自动绑定图片
    currentImageIndex: 0,    // 当前图片索引
    imageBindings: [],       // 图片绑定列表 [{textRange, imageUrl, prompt}]
    images: [],             // 图片列表
    currentStoryId: null,   // 当前故事ID
    characterDescriptions: [],  // 新增：角色/场景描述列表
};

// 配置
let writerConfig = {
    koboldcppUrl: 'http://127.0.0.1:5001',
    comfyuiUrl: '127.0.0.1:8188',
    imageGeneration: true,
    storyboardMode: true,   // 连环画模式 - 默认开启
    autoBind: true,          // 自动绑定
    autoGenerate: false,     // 自动生成图片
    generateInterval: 500,   // 每多少字生成一张图片
    lastGeneratedPosition: 0, // 上次生成位置
    maxImages: 20,           // 最大图片数
    localImagesEnabled: true, // 启用本地图片加载
    characterPresets: [],  // 角色预设
    apiType: 'local', // 'local' 或 'remote'
    remoteApiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    remoteModel: 'gpt-3.5-turbo',
    remoteProvider: 'openai', // 'openai', 'claude', 'deepseek', 'custom'
};

const API_PROVIDERS = {
    openai: {
        name: 'OpenAI',
        defaultUrl: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-3.5-turbo',        requiresKey: true,
        headers: {
            'Content-Type': 'application/json'
        }
    },
    claude: {
        name: 'Claude (Anthropic)',
        defaultUrl: 'https://api.anthropic.com/v1/messages',
        defaultModel: 'claude-3-sonnet-20240229',
        requiresKey: true,
        headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
        }
    },
    deepseek: {
        name: 'DeepSeek',
        defaultUrl: 'https://api.deepseek.com/v1/chat/completions',
        defaultModel: 'deepseek-chat',
        requiresKey: true,
        headers: {
            'Content-Type': 'application/json'
        }
    },
    custom: {
        name: '自定义 (OpenAI兼容)',
        defaultUrl: '',
        defaultModel: '',
        requiresKey: false,
        headers: {
            'Content-Type': 'application/json'
        }
    }
};

// 添加浮动按钮管理
let floatingButtons = {
    characterPanel: null,
    generateImage: null,
};

// 图片查看器状态
const imageViewerState = {
    scale: 1,
    minScale: 0.05,
    maxScale: 10,
    translateX: 0,
    translateY: 0,
    rotation: 0,
    naturalWidth: 0,
    naturalHeight: 0,
    containerWidth: 0,
    containerHeight: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartTX: 0,
    dragStartTY: 0,
    fitMode: true,
    magnifierActive: false,
    magnifierSize: 360,
    magnifyScale: 2,  // 改为 2，表示 2倍放大（原来是 2.0）
    _lastMouseX: 0,
    _lastMouseY: 0,
    imageLoaded: false,
    currentUrl: null
};

// ============================================================
// 参数配置管理
// ============================================================

// 生成参数配置
let generationParams = {
    maxContextLength: 32768,
    seed: -1,              // -1 表示随机
    maxPredictTokens: -1,  // -1 表示1024
    temperature: 0.7,
    repeatPenalty: 1.2,
    repPenRange: 0,
    presPenalty: 0,
    freqPenalty: 0,
    topK: 40,
    topP: 0.9,
    minP: 0,
    ignoreEos: false,
};

// 加载参数配置
function loadGenerationParams() {
    try {
        const saved = localStorage.getItem('writer-mode-generation-params');
        if (saved) {
            const parsed = JSON.parse(saved);
            generationParams = { ...generationParams, ...parsed };
        }
    } catch (e) {
        console.error('[WriterMode] 参数配置加载失败:', e);
    }
}

// 保存参数配置
function saveGenerationParams() {
    try {
        localStorage.setItem('writer-mode-generation-params', JSON.stringify(generationParams));
    } catch (e) {
        console.error('[WriterMode] 参数配置保存失败:', e);
    }
}

// ============================================================
// 浮动调参按钮
// ============================================================

function createParamButton() {
    const existingBtn = document.getElementById('writer-param-btn');
    if (existingBtn) return;

    const btn = document.createElement('button');
    btn.id = 'writer-param-btn';
    btn.innerHTML = '⚙️';
    btn.title = '生成参数设置';
    btn.style.cssText = `
        position: fixed;
        bottom: 150px;
        right: 20px;
        width: 40px;
        height: 40px;
        background: rgba(0,255,255,0.15);
        border: 1px solid rgba(0,255,255,0.4);
        border-radius: 50%;
        color: #0ff;
        font-size: 20px;
        cursor: pointer;
        z-index: 1000000;
        transition: all 0.3s;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: monospace;
        pointer-events: auto;
    `;
    btn.onmouseenter = () => {
        btn.style.transform = 'scale(1.1)';
        btn.style.boxShadow = '0 0 20px rgba(0,255,255,0.3)';
    };
    btn.onmouseleave = () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = 'none';
    };
    btn.onclick = openParamModal;
    document.body.appendChild(btn);
}

// ============================================================
// 参数配置模态框
// ============================================================

function openParamModal() {
    const existingModal = document.getElementById('writer-param-modal');
    if (existingModal) {
        existingModal.remove();
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'writer-param-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.75);
        z-index: 1000002;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(8px);
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: rgba(10, 15, 25, 0.97);
        border: 1px solid rgba(0, 255, 255, 0.4);
        border-radius: 16px;
        padding: 28px 32px;
        width: 580px;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
        color: #ccf;
    `;

    dialog.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid rgba(0,255,255,0.15);padding-bottom:15px;">
            <h2 style="color:#0ff;margin:0;font-size:18px;">⚙️ 生成参数配置</h2>
            <button id="param-modal-close" style="background:none;border:none;color:#0ff;font-size:24px;cursor:pointer;padding:0 8px;">✕</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;">
            <!-- 左列 -->
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Max Context Length</label>
                <input type="number" id="param-max-context" value="${generationParams.maxContextLength}" 
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Seed <span style="color:#666;">(-1 = 随机)</span></label>
                <input type="number" id="param-seed" value="${generationParams.seed}" 
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Max Predict Tokens <span style="color:#666;">(-1 = 1024)</span></label>
                <input type="number" id="param-max-tokens" value="${generationParams.maxPredictTokens}" 
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Temperature</label>
                <input type="number" id="param-temperature" value="${generationParams.temperature}" step="0.01" min="0" max="2"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
                <input type="range" id="param-temperature-slider" min="0" max="200" value="${generationParams.temperature * 100}" step="1"
                       style="width:100%;margin-top:4px;height:3px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.12);border-radius:2px;outline:none;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Repeat Penalty</label>
                <input type="number" id="param-rep-penalty" value="${generationParams.repeatPenalty}" step="0.01" min="0" max="3"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
                <input type="range" id="param-rep-penalty-slider" min="0" max="300" value="${generationParams.repeatPenalty * 100}" step="1"
                       style="width:100%;margin-top:4px;height:3px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.12);border-radius:2px;outline:none;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Rep Pen Range <span style="color:#666;">(0 = 全部)</span></label>
                <input type="number" id="param-rep-range" value="${generationParams.repPenRange}" step="1" min="0"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Presence Penalty</label>
                <input type="number" id="param-pres-penalty" value="${generationParams.presPenalty}" step="0.01" min="0" max="2"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Frequency Penalty</label>
                <input type="number" id="param-freq-penalty" value="${generationParams.freqPenalty}" step="0.01" min="0" max="2"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:16px;padding-top:16px;border-top:1px solid rgba(0,255,255,0.1);">
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Top K</label>
                <input type="number" id="param-top-k" value="${generationParams.topK}" step="1" min="0"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Top P</label>
                <input type="number" id="param-top-p" value="${generationParams.topP}" step="0.01" min="0" max="1"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
                <input type="range" id="param-top-p-slider" min="0" max="100" value="${generationParams.topP * 100}" step="1"
                       style="width:100%;margin-top:4px;height:3px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.12);border-radius:2px;outline:none;">
            </div>
            <div>
                <label style="color:#888;font-size:11px;display:block;margin-bottom:4px;">Min P</label>
                <input type="number" id="param-min-p" value="${generationParams.minP}" step="0.01" min="0" max="1"
                       style="width:100%;padding:6px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.25);border-radius:6px;color:#0ff;font-family:monospace;font-size:13px;box-sizing:border-box;">
                <input type="range" id="param-min-p-slider" min="0" max="100" value="${generationParams.minP * 100}" step="1"
                       style="width:100%;margin-top:4px;height:3px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.12);border-radius:2px;outline:none;">
            </div>
        </div>

        <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(0,255,255,0.1);display:flex;align-items:center;gap:16px;">
            <label style="display:flex;align-items:center;gap:8px;color:#888;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="param-ignore-eos" ${generationParams.ignoreEos ? 'checked' : ''} style="accent-color:#0ff;width:16px;height:16px;">
                忽略 &lt;eos&gt; 停止符
            </label>
            <button id="param-reset-default" style="padding:4px 16px;background:rgba(255,255,0,0.1);border:1px solid rgba(255,255,0,0.3);color:#ff0;border-radius:6px;cursor:pointer;font-family:monospace;font-size:12px;">↺ 重置默认</button>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;padding-top:15px;border-top:1px solid rgba(0,255,255,0.1);">
            <button id="param-save" style="${createButtonStyle('#0f0', 'rgba(0,255,0,0.15)')}">💾 保存参数</button>
            <button id="param-cancel" style="${createButtonStyle('#f00', 'rgba(255,0,0,0.15)')}">取消</button>
        </div>
    `;

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // ====== 绑定事件 ======
    
    // 滑块联动
    bindSliderToInput('param-temperature', 'param-temperature-slider', 100);
    bindSliderToInput('param-rep-penalty', 'param-rep-penalty-slider', 100);
    bindSliderToInput('param-top-p', 'param-top-p-slider', 100);
    bindSliderToInput('param-min-p', 'param-min-p-slider', 100);

    // 关闭
    document.getElementById('param-modal-close').onclick = () => modal.remove();
    document.getElementById('param-cancel').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // 保存
    document.getElementById('param-save').onclick = () => {
        saveParamsFromModal();
        modal.remove();
        showToast('✅ 参数已保存');
    };

    // 重置默认
    document.getElementById('param-reset-default').onclick = () => {
        const defaults = {
            maxContextLength: 32768,
            seed: -1,
            maxPredictTokens: -1,
            temperature: 0.7,
            repeatPenalty: 1.2,
            repPenRange: 0,
            presPenalty: 0,
            freqPenalty: 0,
            topK: 40,
            topP: 0.9,
            minP: 0,
            ignoreEos: false,
        };
        generationParams = { ...defaults };
        saveGenerationParams();
        // 刷新输入框值
        refreshParamInputs();
        showToast('↺ 已重置为默认参数');
    };
}

// 滑块绑定辅助函数
function bindSliderToInput(inputId, sliderId, multiplier) {
    const input = document.getElementById(inputId);
    const slider = document.getElementById(sliderId);
    if (!input || !slider) return;
    
    input.oninput = function() {
        const val = parseFloat(this.value) || 0;
        slider.value = Math.round(val * multiplier);
    };
    slider.oninput = function() {
        const val = parseFloat(this.value) / multiplier;
        input.value = val.toFixed(2);
    };
}

// 刷新参数输入框
function refreshParamInputs() {
    const fields = [
        'max-context', 'seed', 'max-tokens', 'temperature', 'rep-penalty',
        'rep-range', 'pres-penalty', 'freq-penalty', 'top-k', 'top-p', 'min-p'
    ];
    fields.forEach(field => {
        const el = document.getElementById(`param-${field}`);
        if (el) {
            const key = field.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            if (key === 'maxContext') el.value = generationParams.maxContextLength;
            else if (key === 'maxTokens') el.value = generationParams.maxPredictTokens;
            else if (key in generationParams) el.value = generationParams[key];
        }
    });
    const ignoreEos = document.getElementById('param-ignore-eos');
    if (ignoreEos) ignoreEos.checked = generationParams.ignoreEos;
}

// 从模态框保存参数
function saveParamsFromModal() {
    const getVal = (id) => parseFloat(document.getElementById(id)?.value) || 0;
    const getInt = (id) => parseInt(document.getElementById(id)?.value) || -1;
    
    generationParams.maxContextLength = getInt('param-max-context');
    generationParams.seed = getInt('param-seed');
    generationParams.maxPredictTokens = getInt('param-max-tokens');
    generationParams.temperature = getVal('param-temperature');
    generationParams.repeatPenalty = getVal('param-rep-penalty');
    generationParams.repPenRange = getInt('param-rep-range');
    generationParams.presPenalty = getVal('param-pres-penalty');
    generationParams.freqPenalty = getVal('param-freq-penalty');
    generationParams.topK = getInt('param-top-k');
    generationParams.topP = getVal('param-top-p');
    generationParams.minP = getVal('param-min-p');
    
    const ignoreEos = document.getElementById('param-ignore-eos');
    if (ignoreEos) generationParams.ignoreEos = ignoreEos.checked;
    
    saveGenerationParams();
}

// 获取当前参数（用于生成请求）
function getGenerationParams() {
    return { ...generationParams };
}

// ============================================================
// 字数统计功能
// ============================================================

let wordCounterInterval = null;

function createWordCounter() {
    const counter = document.createElement('div');
    counter.id = 'writer-word-counter';
    counter.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: rgba(0,0,0,0.7);
        border: 1px solid rgba(0,255,255,0.2);
        border-radius: 10px;
        padding: 8px 14px;
        color: #888;
        font-family: monospace;
        font-size: 12px;
        z-index: 1000000;
        backdrop-filter: blur(5px);
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 140px;
        pointer-events: none;
    `;
    counter.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
            <span>📝 字数</span>
            <span id="word-count-display" style="color:#0ff;">0</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
            <span>🪙 Tokens</span>
            <span id="token-count-display" style="color:#f0a;">估算中...</span>
        </div>
    `;
    document.body.appendChild(counter);
    return counter;
}

// 更新字数统计
function updateWordCounter() {
    if (!textarea) return;
    
    const text = textarea.value || '';
    const charCount = text.length;
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    
    // 更准确的字数：中文按字符数，英文按单词数
    const totalWords = chineseCharCount + wordCount;
    
    const wordDisplay = document.getElementById('word-count-display');
    if (wordDisplay) {
        wordDisplay.textContent = totalWords;
    }
    
    // 估算 Tokens (简单估算：中文约1.5字符/token，英文约0.75单词/token)
    const estimatedTokens = Math.round(chineseCharCount / 1.5 + wordCount / 0.75);
    const tokenDisplay = document.getElementById('token-count-display');
    if (tokenDisplay) {
        tokenDisplay.textContent = estimatedTokens.toLocaleString();
    }
}

// 启动字数统计定时器
function startWordCounter() {
    if (wordCounterInterval) clearInterval(wordCounterInterval);
    updateWordCounter();
    wordCounterInterval = setInterval(updateWordCounter, 1000);
}

// 停止字数统计定时器
function stopWordCounter() {
    if (wordCounterInterval) {
        clearInterval(wordCounterInterval);
        wordCounterInterval = null;
    }
}

// 图片存储管理 - 使用IndexedDB替代localStorage
class ImageStorage {
    constructor() {
        this.db = null;
        this.init();
    }
    
    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('WriterModeDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    const store = db.createObjectStore('images', { keyPath: 'id' });
                    store.createIndex('storyId', 'storyId', { unique: false });
                }
                if (!db.objectStoreNames.contains('stories')) {
                    const store = db.createObjectStore('stories', { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }
    // 添加保存绑定的方法
    async saveBindings(storyId, bindings) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['stories'], 'readwrite');
            const store = transaction.objectStore('stories');
            
            const record = {
                id: `bindings_${storyId}`,
                bindings: bindings,
                timestamp: Date.now()
            };
            
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    // 添加加载绑定的方法
    async loadBindings(storyId) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['stories'], 'readonly');
            const store = transaction.objectStore('stories');
            
            const request = store.get(`bindings_${storyId}`);
            request.onsuccess = () => resolve(request.result?.bindings || []);
            request.onerror = () => reject(request.error);
        });
    }
    async saveImage(storyId, imageData) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            
            const record = {
                id: `${storyId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                storyId: storyId,
                imageUrl: imageData.url,
                prompt: imageData.prompt,
                timestamp: imageData.timestamp,
                isLocal: imageData.isLocal || false,
                localPath: imageData.localPath || ''
            };
            
            const request = store.put(record);
            request.onsuccess = () => resolve(record);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getImages(storyId) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const index = store.index('storyId');
            
            const request = index.getAll(storyId);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
    
    async deleteImage(imageId) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            
            const request = store.delete(imageId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async saveStoryContent(storyId, content) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['stories'], 'readwrite');
            const store = transaction.objectStore('stories');
            
            const record = {
                id: storyId,
                content: content,
                timestamp: Date.now()
            };
            
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async getStoryContent(storyId) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['stories'], 'readonly');
            const store = transaction.objectStore('stories');
            
            const request = store.get(storyId);
            request.onsuccess = () => resolve(request.result?.content || '');
            request.onerror = () => reject(request.error);
        });
    }
}

const imageStorage = new ImageStorage();

// 本地图片管理器 - 修复路径检测
class LocalImageManager {
    constructor() {
        this.pluginPath = '';
        this.cache = new Map();
        this.detectPluginPath();
    }
    
    detectPluginPath() {
        const scripts = document.getElementsByTagName('script');
        for (let script of scripts) {
            const src = script.src;
            if (src && (src.includes('WriterMode') || src.includes('index.js'))) {
                const match = src.match(/(.*WriterMode[\/\\])/i);
                if (match) {
                    this.pluginPath = match[1];
                    console.log('[WriterMode] 插件路径:', this.pluginPath);
                    break;
                }
            }
        }
        
        if (!this.pluginPath) {
            try {
                const currentScript = document.currentScript;
                if (currentScript && currentScript.src) {
                    const match = currentScript.src.match(/(.*WriterMode[\/\\])/i);
                    if (match) {
                        this.pluginPath = match[1];
                        console.log('[WriterMode] 插件路径(currentScript):', this.pluginPath);
                    }
                }
            } catch (e) {
                console.warn('[WriterMode] 无法获取插件路径');
            }
        }
        
        if (!this.pluginPath) {
            this.pluginPath = 'scripts/extensions/third-party/WriterMode/';
            console.log('[WriterMode] 使用默认插件路径:', this.pluginPath);
        }
    }
    
    // 检查图片文件是否存在 - 使用更可靠的方法
    async checkImageExists(url) {
        return new Promise((resolve) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                img.onload = null;
                img.onerror = null;
                resolve(false);
            }, 3000);
            
            img.onload = () => {
                clearTimeout(timeout);
                resolve(true);
            };
            img.onerror = () => {
                clearTimeout(timeout);
                resolve(false);
            };
            img.src = url + '?t=' + Date.now(); // 添加时间戳避免缓存
        });
    }
    
    // 快速检查是否有任何图片存在
    async hasAnyImage(storyId) {
        const cacheKey = `has_any_${storyId}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        
        const imagesPath = `${this.pluginPath}images/${storyId}/`;
        const testNames = ['01', '1', 'cover', 'image_1', 'img_1'];
        const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        
        for (const name of testNames) {
            for (const ext of extensions) {
                const url = `${imagesPath}${name}${ext}`;
                if (await this.checkImageExists(url)) {
                    this.cache.set(cacheKey, true);
                    return true;
                }
            }
        }
        
        this.cache.set(cacheKey, false);
        return false;
    }
    
    async loadLocalImages(storyId) {
        if (!writerConfig.localImagesEnabled || !storyId) return [];
        
        const cacheKey = `images_${storyId}`;
        if (this.cache.has(cacheKey)) {
            console.log('[WriterMode] 使用缓存的本地图片列表');
            return this.cache.get(cacheKey);
        }
        
        try {
            const imagesPath = `${this.pluginPath}images/${storyId}/`;
            console.log('[WriterMode] 检查本地图片路径:', imagesPath);
            
            // 先快速检查是否有任何图片存在
            const hasImages = await this.hasAnyImage(storyId);
            if (!hasImages) {
                console.log('[WriterMode] 没有找到本地图片，跳过');
                this.cache.set(cacheKey, []);
                return [];
            }
            
            let imageFiles = [];
            
            // 方法1：尝试读取目录列表（如果服务器支持）
            try {
                const response = await fetch(imagesPath, { cache: 'no-cache' });
                if (response.ok) {
                    const html = await response.text();
                    const fileMatches = html.match(/href="([^"]*\.(jpg|jpeg|png|gif|webp|bmp))"/gi);
                    if (fileMatches) {
                        imageFiles = fileMatches.map(match => {
                            const hrefMatch = match.match(/href="([^"]*)"/i);
                            return hrefMatch ? decodeURIComponent(hrefMatch[1]) : '';
                        }).filter(Boolean);
                        console.log('[WriterMode] 从目录列表找到图片:', imageFiles.length, '张');
                    }
                }
            } catch (e) {
                console.log('[WriterMode] 目录列表获取失败，使用智能检测');
            }
            
            // 方法2：智能检测 - 只要检测到有图片，就尝试找出所有图片
            if (imageFiles.length === 0) {
                imageFiles = await this.smartDetectImages(imagesPath);
                console.log('[WriterMode] 智能检测找到图片:', imageFiles.length, '张');
            }
            
            if (imageFiles.length === 0) {
                this.cache.set(cacheKey, []);
                return [];
            }
            
            imageFiles = this.sortImageFiles(imageFiles);
            
            // 限制数量
            const MAX_LOCAL_IMAGES = 100;
            if (imageFiles.length > MAX_LOCAL_IMAGES) {
                imageFiles = imageFiles.slice(0, MAX_LOCAL_IMAGES);
            }
            
            const images = imageFiles.map((fileName, index) => ({
                id: `local_${storyId}_${index}_${Date.now()}`,
                url: `${imagesPath}${fileName}`,
                prompt: `本地图片: ${fileName}`,
                timestamp: Date.now() + index,
                isLocal: true,
                localPath: `${imagesPath}${fileName}`,
                fileName: fileName
            }));
            
            this.cache.set(cacheKey, images);
            return images;
            
        } catch (error) {
            console.error('[WriterMode] 加载本地图片失败:', error);
            this.cache.set(cacheKey, []);
            return [];
        }
    }
    
    // 智能检测图片 - 优化版
    async smartDetectImages(imagesPath) {
        const imageFiles = [];
        const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        
        // 1. 检测数字命名: 01, 02, 03... (最多30张)
        let foundAny = false;
    for (let i = 1; i <= 50; i++) {
        // 尝试两种格式
        const numStr1 = String(i);                    // "1", "2", "3"...
        const numStr2 = String(i).padStart(2, '0');  // "01", "02", "03"...
        
        let found = false;
        // 先尝试无前导零
        for (const ext of extensions) {
            const url = `${imagesPath}${numStr1}${ext}`;
            if (await this.checkImageExists(url)) {
                imageFiles.push(`${numStr1}${ext}`);
                found = true;
                foundAny = true;
                break;
            }
        }
        // 如果没找到，尝试有前导零
        if (!found) {
            for (const ext of extensions) {
                const url = `${imagesPath}${numStr2}${ext}`;
                if (await this.checkImageExists(url)) {
                    imageFiles.push(`${numStr2}${ext}`);
                    found = true;
                    foundAny = true;
                    break;
                }
            }
        }
        
        // 跳出条件
        if (!found && i > 10) {
            let hasMore = false;
            for (let j = i + 1; j <= Math.min(i + 5, 50); j++) {
                const nextNum1 = String(j);
                const nextNum2 = String(j).padStart(2, '0');
                for (const ext of extensions) {
                    const url1 = `${imagesPath}${nextNum1}${ext}`;
                    const url2 = `${imagesPath}${nextNum2}${ext}`;
                    if (await this.checkImageExists(url1) || await this.checkImageExists(url2)) {
                        hasMore = true;
                        break;
                    }
                }
                if (hasMore) break;
            }
            if (!hasMore) break;
        }
    }
        
        // 如果找到了数字命名的图片，直接返回
        if (imageFiles.length > 0) {
            return imageFiles;
        }
        
        // 2. 检测命名模式
        const patterns = [
            { prefix: 'image_', start: 1, end: 15 },
            { prefix: 'img_', start: 1, end: 15 },
            { prefix: 'scene_', start: 1, end: 10 },
            { prefix: 'page_', start: 1, end: 10 },
            { prefix: 'chapter_', start: 1, end: 10 },
            { prefix: 'pic_', start: 1, end: 10 },
            { prefix: 'photo_', start: 1, end: 10 }
        ];
        
        for (const pattern of patterns) {
            const found = [];
            for (let i = pattern.start; i <= pattern.end; i++) {
                let foundThis = false;
                for (const ext of extensions) {
                    const url = `${imagesPath}${pattern.prefix}${i}${ext}`;
                    if (await this.checkImageExists(url)) {
                        found.push(`${pattern.prefix}${i}${ext}`);
                        foundThis = true;
                        break;
                    }
                }
                // 如果连续3张不存在，停止这个模式
                if (!foundThis && i > pattern.start + 3) {
                    break;
                }
            }
            if (found.length > 0) {
                return found;
            }
        }
        
        // 3. 检测单张图片: cover, main, title, banner, hero
        const singleNames = ['cover', 'main', 'title', 'banner', 'hero', 'poster', 'thumbnail'];
        for (const name of singleNames) {
            for (const ext of extensions) {
                const url = `${imagesPath}${name}${ext}`;
                if (await this.checkImageExists(url)) {
                    imageFiles.push(`${name}${ext}`);
                    return imageFiles; // 找到一张就返回
                }
            }
        }
        
        return imageFiles;
    }
    
    sortImageFiles(files) {
        return files.sort((a, b) => {
            const aMatch = a.match(/(\d+)/g);
            const bMatch = b.match(/(\d+)/g);
            
            if (aMatch && bMatch) {
                const aNum = parseInt(aMatch[0]);
                const bNum = parseInt(bMatch[0]);
                if (aNum !== bNum) {
                    return aNum - bNum;
                }
            } else if (aMatch) {
                return -1;
            } else if (bMatch) {
                return 1;
            }
            
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
    }
    
    clearCache(storyId) {
        if (storyId) {
            this.cache.delete(`has_any_${storyId}`);
            this.cache.delete(`images_${storyId}`);
        } else {
            this.cache.clear();
        }
        console.log('[WriterMode] 缓存已清空');
    }
}

const localImageManager = new LocalImageManager();

// ComfyUI工作流模板
const WORKFLOW_TEMPLATE = {
    "1": {
        "inputs": {"images": ["8", 0]},
        "class_type": "PreviewImage",
        "_meta": {"title": "预览图像"}
    },
    "8": {
        "inputs": {
            "samples": ["19", 0],
            "vae": ["15", 0]
        },
        "class_type": "VAEDecode",
        "_meta": {"title": "VAE解码"}
    },
    "11": {
        "inputs": {
            "text": "",  // 正面提示词
            "clip": ["54", 0]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "CLIP Text Encode (Positive Prompt)"}
    },
    "12": {
        "inputs": {
            "text": "3DCG, @ai-generated, worst quality, low quality, blurry, jpeg artifacts, censored, censorship, pixelated, bar censor, mosaic, signature, grayscale, monochrome, simple background",
            "clip": ["54", 0]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "CLIP Text Encode (Negative Prompt)"}
    },
    "15": {
        "inputs": {"vae_name": "qwen_image_vae.safetensors"},
        "class_type": "VAELoader",
        "_meta": {"title": "加载VAE"}
    },
    "19": {
        "inputs": {
            "seed": 600107220829687,
            "steps": 8,
            "cfg": 1,
            "sampler_name": "er_sde",
            "scheduler": "simple",
            "denoise": 1,
            "model": ["61", 0],
            "positive": ["11", 0],
            "negative": ["12", 0],
            "latent_image": ["28", 0]
        },
        "class_type": "KSampler",
        "_meta": {"title": "K采样器"}
    },
    "28": {
        "inputs": {
            "width": 1200,
            "height": 800,
            "batch_size": 1
        },
        "class_type": "EmptyLatentImage",
        "_meta": {"title": "空Latent图像"}
    },
    "44": {
        "inputs": {
            "unet_name": "anima-base-v1.0.safetensors",
            "weight_dtype": "default"
        },
        "class_type": "UNETLoader",
        "_meta": {"title": "UNet加载器"}
    },
    "54": {
        "inputs": {
            "clip_name": "qwen_3_06b_base.safetensors",
            "type": "qwen_image",
            "device": "default"
        },
        "class_type": "CLIPLoader",
        "_meta": {"title": "加载CLIP"}
    },
    "61": {
        "inputs": {
            "lora_name": "Anima\\anima-turbo-lora-v0.2.safetensors",
            "strength_model": 1,
            "model": ["44", 0]
        },
        "class_type": "LoraLoaderModelOnly",
        "_meta": {"title": "LoRA加载器（仅模型）"}
    },
    "62": {
        "inputs": {
            "filename_prefix": "ComfyUI",
            "images": ["1", 0]
        },
        "class_type": "SaveImage",
        "_meta": {"title": "保存图像"}
    }
};

// 等待SillyTavern加载
async function init() {
    if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
        setTimeout(init, 200);
        return;
    }
    
    context = SillyTavern.getContext();
    console.log('[WriterMode] 初始化完成');
    
    loadConfig();
    loadCustomTemplates(); // 添加这一行
    await loadWorkflowList(); // 添加这一行
    await imageStorage.init();
    await loadStoryData();
    
    // 添加样式
    addImageViewerStyles();
    
    addWriterButton();
}

// 加载配置
function loadConfig() {
    try {
        const saved = localStorage.getItem('writer-mode-config');
        if (saved) {
            const parsed = JSON.parse(saved);
            writerConfig = { ...writerConfig, ...parsed };
        }
    } catch (e) {
        console.error('[WriterMode] 配置加载失败:', e);
    }
}

// 保存配置
function saveConfig() {
    try {
        localStorage.setItem('writer-mode-config', JSON.stringify(writerConfig));
    } catch (e) {
        console.error('[WriterMode] 配置保存失败:', e);
    }
}

// 修改 loadStoryData 函数，在加载图片和绑定数据后，也加载文本内容
async function loadStoryData() {
    try {
        const currentStory = localStorage.getItem('writer-mode-current-story');
        if (currentStory) {
            storyMode.currentStoryId = currentStory;
            
            // 从 IndexedDB 加载图片
            const images = await imageStorage.getImages(currentStory);
            
            // 加载本地图片
            let localImages = [];
            if (writerConfig.localImagesEnabled) {
                localImages = await localImageManager.loadLocalImages(currentStory);
            }
            
            storyMode.images = [...localImages, ...images.filter(img => !img.isLocal)];
            
            // 从 IndexedDB 加载绑定数据
            let bindings = await imageStorage.loadBindings(currentStory);
            
            // 如果 IndexedDB 没有，尝试从 localStorage 迁移
            if (bindings.length === 0) {
                const bindingsData = localStorage.getItem(`writer-bindings-${currentStory}`);
                if (bindingsData) {
                    try {
                        const oldBindings = JSON.parse(bindingsData);
                        // 转换为新格式
                        bindings = oldBindings.map(b => ({
                            textRange: b.textRange || { start: 0, end: 0 },
                            startRatio: b.startRatio || 0,
                            endRatio: b.endRatio || 1,
                            imageId: b.imageId || b.id || '',
                            prompt: b.prompt || '',
                            timestamp: b.timestamp || Date.now()
                        }));
                        // 迁移到 IndexedDB
                        await imageStorage.saveBindings(currentStory, bindings);
                        // 清理 localStorage
                        localStorage.removeItem(`writer-bindings-${currentStory}`);
                        console.log('[WriterMode] 绑定数据已从 localStorage 迁移到 IndexedDB');
                    } catch (e) {
                        console.warn('[WriterMode] 绑定数据迁移失败:', e);
                    }
                }
            }
            
            storyMode.imageBindings = bindings;
            
            // ====== 添加：加载文本内容 ======
            // 这里只加载到内存，实际的 textarea 内容在 restoreContent 中设置
            // 但我们需要在打开 Writer Mode 时调用 restoreContent
            
            console.log('[WriterMode] 加载图片:', storyMode.images.length, '张');
            console.log('[WriterMode] 加载绑定:', storyMode.imageBindings.length, '条');
        }
    } catch (e) {
        console.error('[WriterMode] 故事数据加载失败:', e);
    }
}

async function saveStoryData() {
    if (!storyMode.currentStoryId) return;
    
    try {
        // 准备轻量级的绑定数据（不包含完整图片URL）
        const lightBindings = storyMode.imageBindings.map(binding => ({
            textRange: binding.textRange || { start: 0, end: 0 },
            startRatio: binding.startRatio || 0,
            endRatio: binding.endRatio || 1,
            imageId: binding.imageId || binding.id,
            prompt: binding.prompt || '',
            timestamp: binding.timestamp || Date.now()
        }));
        
        // 保存到 IndexedDB
        await imageStorage.saveBindings(storyMode.currentStoryId, lightBindings);
        
        // 同时保存一个轻量级的副本到 localStorage（仅用于快速恢复）
        try {
            const minimalData = lightBindings.map(b => ({
                startRatio: b.startRatio,
                endRatio: b.endRatio,
                imageId: b.imageId
            }));
            localStorage.setItem(
                `writer-bindings-${storyMode.currentStoryId}`, 
                JSON.stringify(minimalData)
            );
        } catch (e) {
            // localStorage 满了就忽略，不影响主要功能
            console.warn('[WriterMode] localStorage 存储跳过（空间不足）');
        }
        
        console.log('[WriterMode] 绑定数据保存成功:', lightBindings.length, '条');
    } catch (e) {
        console.error('[WriterMode] 故事数据保存失败:', e);
    }
}

// 添加作家模式按钮
function addWriterButton() {
    if (document.getElementById('writer-mode-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'writer-mode-btn';
    btn.innerHTML = '✎ 作家模式';
    btn.style.cssText = `
        position: fixed;
        bottom: 530px;
        right: 20px;
        background: linear-gradient(135deg, #0ff, #06f);
        border: none;
        color: white;
        padding: 10px 20px;
        border-radius: 30px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        z-index: 100000;
        box-shadow: 0 0 20px rgba(0,255,255,0.3);
        transition: all 0.2s;
        font-family: monospace;
    `;
    btn.onmouseenter = () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.boxShadow = '0 0 30px rgba(0,255,255,0.6)';
    };
    btn.onmouseleave = () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 0 20px rgba(0,255,255,0.3)';
    };
    btn.onclick = openWriterMode;
    document.body.appendChild(btn);
}

// 打开作家模式
async function openWriterMode() {
    if (overlay) return;
    
    overlay = document.createElement('div');
    overlay.id = 'writer-mode-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle at 20% 30%, #0a0e1a, #03050a);
        z-index: 1000000;
        display: flex;
        flex-direction: column;
        font-family: 'Courier New', monospace;
    `;
    
    const grid = document.createElement('div');
    grid.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-image: 
            linear-gradient(rgba(0,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.05) 1px, transparent 1px);
        background-size: 30px 30px;
        pointer-events: none;
    `;
    overlay.appendChild(grid);
    
    const header = createHeader();
    overlay.appendChild(header);
    // 添加模板按钮到 header
    addTemplateButtonToHeader(header);
    const contentArea = document.createElement('div');
    contentArea.id = 'writer-content-area';
    contentArea.style.cssText = `
        flex: 1;
        display: flex;
        overflow: hidden;
        z-index: 10;
        position: relative;
    `;
    
    const writingArea = createWritingArea();
    contentArea.appendChild(writingArea);
    
    if (writerConfig.storyboardMode) {
        const imageArea = createImageArea();
        contentArea.appendChild(imageArea);
    }
    
    overlay.appendChild(contentArea);
    
    const statusIndicator = createStatusIndicator();
    overlay.appendChild(statusIndicator);
    
    document.body.appendChild(overlay);
    
    bindEvents();

    await restoreContent();
    await refreshLocalImages();
    
    // 初始化图片查看器
    initImageViewer();

    // 加载角色描述
    loadCharacterDescriptions();

    // 添加浮动按钮
    createFloatingButtons();
    
    // 如果有图片，显示第一张
    if (storyMode.images.length > 0) {
        const image = storyMode.images[storyMode.currentImageIndex] || storyMode.images[0];
        if (image) {
            displayImage(image.url);
        }
    }
    
    textarea.focus();
}

// 加载角色描述
function loadCharacterDescriptions() {
    if (!storyMode.currentStoryId) return;
    
    try {
        const saved = localStorage.getItem(`writer-characters-${storyMode.currentStoryId}`);
        if (saved) {
            storyMode.characterDescriptions = JSON.parse(saved);
        } else {
            storyMode.characterDescriptions = [];
        }
    } catch (e) {
        console.error('[WriterMode] 角色描述加载失败:', e);
        storyMode.characterDescriptions = [];
    }
}

// 保存角色描述
async function saveCharacterDescriptions() {
    if (!storyMode.currentStoryId) return;
    
    try {
        localStorage.setItem(
            `writer-characters-${storyMode.currentStoryId}`, 
            JSON.stringify(storyMode.characterDescriptions)
        );
    } catch (e) {
        console.error('[WriterMode] 角色描述保存失败:', e);
    }
}

// 创建浮动按钮
function createFloatingButtons() {
    // 移除已存在的按钮
    removeFloatingButtons();
    
    // 创建容器
    const container = document.createElement('div');
    container.id = 'writer-floating-buttons';
    container.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 200px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 1000001;
    `;
    
    // 角色描述按钮
    const characterBtn = document.createElement('button');
    characterBtn.id = 'writer-character-btn';
    characterBtn.innerHTML = '👥 角色设定';
    characterBtn.style.cssText = `
        padding: 12px 20px;
        background: linear-gradient(135deg, rgba(255,100,150,0.3), rgba(200,50,100,0.4));
        border: 1px solid #ff6b9d;
        color: #ffb3c6;
        border-radius: 25px;
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 15px rgba(255,100,150,0.3);
        pointer-events: auto;
        min-width: 140px;
    `;
    characterBtn.onmouseenter = () => {
        characterBtn.style.transform = 'scale(1.05)';
        characterBtn.style.boxShadow = '0 6px 20px rgba(255,100,150,0.5)';
    };
    characterBtn.onmouseleave = () => {
        characterBtn.style.transform = 'scale(1)';
        characterBtn.style.boxShadow = '0 4px 15px rgba(255,100,150,0.3)';
    };
    characterBtn.onclick = openCharacterPanel;
    
    // AI生成图片按钮
    const generateBtn = document.createElement('button');
    generateBtn.id = 'writer-generate-img-btn';
    generateBtn.innerHTML = '🎨 AI生成图片';
    generateBtn.style.cssText = `
        padding: 12px 20px;
        background: linear-gradient(135deg, rgba(0,255,255,0.3), rgba(0,150,255,0.4));
        border: 1px solid #0ff;
        color: #0ff;
        border-radius: 25px;
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 15px rgba(0,255,255,0.3);
        pointer-events: auto;
        min-width: 140px;
    `;
    generateBtn.onmouseenter = () => {
        generateBtn.style.transform = 'scale(1.05)';
        generateBtn.style.boxShadow = '0 6px 20px rgba(0,255,255,0.5)';
    };
    generateBtn.onmouseleave = () => {
        generateBtn.style.transform = 'scale(1)';
        generateBtn.style.boxShadow = '0 4px 15px rgba(0,255,255,0.3)';
    };
    generateBtn.onclick = openGenerateImagePanel;
    
    container.appendChild(characterBtn);
    container.appendChild(generateBtn);
    
    if (overlay) {
        overlay.appendChild(container);
    } else {
        document.body.appendChild(container);
    }
    
    floatingButtons.characterPanel = characterBtn;
    floatingButtons.generateImage = generateBtn;
}

// 移除浮动按钮
function removeFloatingButtons() {
    const container = document.getElementById('writer-floating-buttons');
    if (container) {
        container.remove();
    }
    floatingButtons.characterPanel = null;
    floatingButtons.generateImage = null;
}

// 打开角色设定面板
function openCharacterPanel() {
    // 检查是否已存在面板
    const existingPanel = document.getElementById('writer-character-panel');
    if (existingPanel) {
        existingPanel.remove();
        return;
    }
    
    const panel = document.createElement('div');
    panel.id = 'writer-character-panel';
    panel.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 300px;
        width: 400px;
        max-height: 60vh;
        background: rgba(10,15,25,0.95);
        border: 1px solid rgba(255,100,150,0.5);
        border-radius: 15px;
        padding: 20px;
        z-index: 1000002;
        overflow-y: auto;
        backdrop-filter: blur(15px);
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
    `;
    
    // 头部
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(255,100,150,0.3);
        flex-shrink: 0;
    `;
    
    const title = document.createElement('h3');
    title.textContent = '👥 角色与场景设定';
    title.style.cssText = `
        color: #ff6b9d;
        margin: 0;
        font-size: 16px;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.type = 'button';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: #ff6b9d;
        font-size: 20px;
        cursor: pointer;
        padding: 0 5px;
        pointer-events: auto;
    `;
    closeBtn.onclick = () => {
        panel.remove();
    };
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);
    
    // 角色列表容器
    const characterList = document.createElement('div');
    characterList.id = 'character-list';
    characterList.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
        flex: 1;
    `;
    panel.appendChild(characterList);
    
    // 添加角色按钮
    const addBtn = document.createElement('button');
    addBtn.innerHTML = '➕ 新增角色/场景';
    addBtn.type = 'button';
    addBtn.style.cssText = `
        width: 100%;
        padding: 10px;
        background: rgba(255,100,150,0.2);
        border: 1px dashed rgba(255,100,150,0.5);
        color: #ff6b9d;
        border-radius: 10px;
        cursor: pointer;
        font-family: monospace;
        font-size: 13px;
        transition: all 0.3s;
        margin-top: 10px;
        flex-shrink: 0;
        pointer-events: auto;
    `;
    addBtn.onclick = () => {
        addCharacterEntry(characterList);
    };
    panel.appendChild(addBtn);
    
    // 先添加面板到DOM
    document.body.appendChild(panel);
    
    // 然后再渲染角色列表
    renderCharacterList(characterList);
}

// 添加角色条目
function addCharacterEntry(container, existingData = null) {
    const entry = document.createElement('div');
    entry.className = 'character-entry';
    entry.style.cssText = `
        background: rgba(0,0,0,0.4);
        border: 1px solid rgba(255,100,150,0.3);
        border-radius: 10px;
        padding: 15px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        position: relative;
        flex-shrink: 0;
    `;
    
    // 角色名称输入
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '角色名称/场景名称';
    nameInput.value = existingData?.name || '';
    nameInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        background: rgba(0,0,0,0.5);
        border: 1px solid rgba(255,100,150,0.3);
        border-radius: 8px;
        color: #ffb3c6;
        font-family: monospace;
        font-size: 13px;
        outline: none;
        box-sizing: border-box;
        pointer-events: auto;
    `;
    
    // 描述输入框
    const descInput = document.createElement('textarea');
    descInput.placeholder = '描述外貌、服装、特征等...\n例如：金色长发，蓝色眼睛，穿着白色连衣裙';
    descInput.value = existingData?.description || '';
    descInput.style.cssText = `
        width: 100%;
        min-height: 80px;
        padding: 8px 12px;
        background: rgba(0,0,0,0.5);
        border: 1px solid rgba(255,100,150,0.3);
        border-radius: 8px;
        color: #ffb3c6;
        font-family: monospace;
        font-size: 12px;
        resize: vertical;
        outline: none;
        box-sizing: border-box;
        pointer-events: auto;
    `;
    
    // 按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    `;
    
    // 删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '🗑️ 删除';
    deleteBtn.type = 'button';
    deleteBtn.style.cssText = `
        padding: 5px 10px;
        background: rgba(255,0,0,0.2);
        border: 1px solid rgba(255,0,0,0.4);
        color: #ff6b6b;
        border-radius: 5px;
        cursor: pointer;
        font-family: monospace;
        font-size: 11px;
        transition: all 0.2s;
        pointer-events: auto;
    `;
    deleteBtn.onclick = () => {
        entry.remove();
        saveCharacterEntries(container);
    };
    
    // 保存按钮
    const saveBtn = document.createElement('button');
    saveBtn.innerHTML = '💾 保存';
    saveBtn.type = 'button';
    saveBtn.style.cssText = `
        padding: 5px 10px;
        background: rgba(0,255,0,0.2);
        border: 1px solid rgba(0,255,0,0.4);
        color: #6bff6b;
        border-radius: 5px;
        cursor: pointer;
        font-family: monospace;
        font-size: 11px;
        transition: all 0.2s;
        pointer-events: auto;
    `;
    saveBtn.onclick = () => {
        saveCharacterEntries(container);
        showToast('角色设定已保存');
    };
    
    buttonContainer.appendChild(deleteBtn);
    buttonContainer.appendChild(saveBtn);
    
    entry.appendChild(nameInput);
    entry.appendChild(descInput);
    entry.appendChild(buttonContainer);
    
    container.appendChild(entry);
}

// 保存角色条目
function saveCharacterEntries(container) {
    const entries = container.querySelectorAll('.character-entry');
    const characters = [];
    
    entries.forEach(entry => {
        const nameInput = entry.querySelector('input[type="text"]');
        const descInput = entry.querySelector('textarea');
        
        if (nameInput && descInput && (nameInput.value.trim() || descInput.value.trim())) {
            characters.push({
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                name: nameInput.value.trim() || '未命名',
                description: descInput.value.trim()
            });
        }
    });
    
    storyMode.characterDescriptions = characters;
    saveCharacterDescriptions();
    console.log('[WriterMode] 角色设定已保存:', characters);
}

// 渲染角色列表
function renderCharacterList(container) {
    container.innerHTML = '';
    
    if (storyMode.characterDescriptions.length > 0) {
        storyMode.characterDescriptions.forEach(character => {
            addCharacterEntry(container, character);
        });
    } else {
        // 如果没有角色，自动添加一个空的
        addCharacterEntry(container);
    }
}

// 打开AI生成图片面板
function openGenerateImagePanel() {
    // 检查是否已存在面板
    const existingPanel = document.getElementById('writer-generate-panel');
    if (existingPanel) {
        existingPanel.remove();
        return;
    }
    
    const panel = document.createElement('div');
    panel.id = 'writer-generate-panel';
    panel.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 300px;
        width: 350px;
        background: rgba(10,15,25,0.95);
        border: 1px solid rgba(0,255,255,0.5);
        border-radius: 15px;
        padding: 20px;
        z-index: 1000002;
        backdrop-filter: blur(15px);
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
        max-height: 70vh;
    `;
    
    // 头部
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        flex-shrink: 0;
    `;
    
    const title = document.createElement('h3');
    title.textContent = '🎨 生成图片';
    title.style.cssText = `
        color: #0ff;
        margin: 0;
        font-size: 16px;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.type = 'button';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: #0ff;
        font-size: 20px;
        cursor: pointer;
        pointer-events: auto;
    `;
    closeBtn.onclick = () => {
        panel.remove();
    };
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);
    
    // 内容区域（可滚动）
    const contentArea = document.createElement('div');
    contentArea.style.cssText = `
        overflow-y: auto;
        flex: 1;
    `;
    
    // 生成方式选择
    const genMethodDiv = document.createElement('div');
    genMethodDiv.style.cssText = `
        margin-bottom: 15px;
    `;
    
    const methodLabel = document.createElement('label');
    methodLabel.textContent = '选择生成方式：';
    methodLabel.style.cssText = `
        color: #888;
        font-size: 12px;
        display: block;
        margin-bottom: 8px;
    `;
    
    const methodButtons = document.createElement('div');
    methodButtons.style.cssText = `
        display: flex;
        gap: 10px;
    `;
    
    const selectionBtn = document.createElement('button');
    selectionBtn.textContent = '📝 选中文本';
    selectionBtn.type = 'button';
    selectionBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        background: rgba(0,255,255,0.15);
        border: 1px solid rgba(0,255,255,0.4);
        color: #0ff;
        border-radius: 8px;
        cursor: pointer;
        font-family: monospace;
        font-size: 12px;
        pointer-events: auto;
        transition: all 0.2s;
    `;
    selectionBtn.onclick = () => {
        panel.remove();
        generateImageFromSelectionWithCharacters();
    };
    
    const chapterBtn = document.createElement('button');
    chapterBtn.textContent = '📖 当前章节';
    chapterBtn.type = 'button';
    chapterBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        background: rgba(0,255,255,0.15);
        border: 1px solid rgba(0,255,255,0.4);
        color: #0ff;
        border-radius: 8px;
        cursor: pointer;
        font-family: monospace;
        font-size: 12px;
        pointer-events: auto;
        transition: all 0.2s;
    `;
    chapterBtn.onclick = () => {
        panel.remove();
        generateImageFromChapterWithCharacters();
    };
    
    methodButtons.appendChild(selectionBtn);
    methodButtons.appendChild(chapterBtn);
    
    genMethodDiv.appendChild(methodLabel);
    genMethodDiv.appendChild(methodButtons);
    contentArea.appendChild(genMethodDiv);
    
    // 自定义提示词
    const customPromptDiv = document.createElement('div');
    customPromptDiv.style.cssText = `
        margin-bottom: 15px;
    `;
    
    const promptLabel = document.createElement('label');
    promptLabel.textContent = '自定义提示词（可选）：';
    promptLabel.style.cssText = `
        color: #888;
        font-size: 12px;
        display: block;
        margin-bottom: 8px;
    `;
    
    const customPromptTextarea = document.createElement('textarea');
    customPromptTextarea.id = 'custom-prompt';
    customPromptTextarea.placeholder = '添加额外的提示词...';
    customPromptTextarea.style.cssText = `
        width: 100%;
        min-height: 60px;
        padding: 8px 12px;
        background: rgba(0,0,0,0.5);
        border: 1px solid rgba(0,255,255,0.3);
        border-radius: 8px;
        color: #0ff;
        font-family: monospace;
        font-size: 12px;
        resize: vertical;
        outline: none;
        box-sizing: border-box;
        pointer-events: auto;
    `;
    
    customPromptDiv.appendChild(promptLabel);
    customPromptDiv.appendChild(customPromptTextarea);
    contentArea.appendChild(customPromptDiv);
    
    // 角色选择
    const characterDiv = document.createElement('div');
    characterDiv.style.cssText = `
        margin-bottom: 15px;
    `;
    
    const characterLabel = document.createElement('label');
    characterLabel.textContent = '使用角色设定：';
    characterLabel.style.cssText = `
        color: #888;
        font-size: 12px;
        display: block;
        margin-bottom: 8px;
    `;
    
    const checkboxContainer = document.createElement('div');
    checkboxContainer.id = 'character-checkboxes';
    checkboxContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 150px;
        overflow-y: auto;
    `;
    
    if (storyMode.characterDescriptions.length > 0) {
        storyMode.characterDescriptions.forEach((character, index) => {
            const label = document.createElement('label');
            label.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                color: #ccc;
                font-size: 12px;
                cursor: pointer;
                padding: 3px 0;
                pointer-events: auto;
            `;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'character-checkbox';
            checkbox.dataset.index = index;
            checkbox.checked = true;
            
            const span = document.createElement('span');
            span.textContent = character.name;
            
            label.appendChild(checkbox);
            label.appendChild(span);
            checkboxContainer.appendChild(label);
        });
    } else {
        checkboxContainer.innerHTML = '<div style="color: #666; font-size: 11px;">暂无角色设定，请先在角色面板中添加</div>';
    }
    
    characterDiv.appendChild(characterLabel);
    characterDiv.appendChild(checkboxContainer);
    contentArea.appendChild(characterDiv);
    
    panel.appendChild(contentArea);
    
    document.body.appendChild(panel);
}

// 获取选中的角色描述
function getSelectedCharacterDescriptions() {
    const checkboxes = document.querySelectorAll('.character-checkbox:checked');
    const descriptions = [];
    
    checkboxes.forEach(checkbox => {
        const index = parseInt(checkbox.dataset.index);
        if (storyMode.characterDescriptions[index]) {
            descriptions.push(storyMode.characterDescriptions[index]);
        }
    });
    
    return descriptions;
}

// 构建包含角色描述的提示词
function buildPromptWithCharacters(baseText, customPrompt = '') {
    const selectedCharacters = getSelectedCharacterDescriptions();
    let characterPrompt = '';
    
    if (selectedCharacters.length > 0) {
        characterPrompt = 'Characters:\n';
        selectedCharacters.forEach(char => {
            characterPrompt += `- ${char.name}: ${char.description}\n`;
        });
    }
    
    let fullPrompt = '';
    if (characterPrompt) {
        fullPrompt += characterPrompt + '\n';
    }
    if (customPrompt) {
        fullPrompt += 'Additional details: ' + customPrompt + '\n';
    }
    fullPrompt += 'Scene: ' + baseText;
    
    return fullPrompt;
}

// 从选择文本生成图片（带角色设定）
async function generateImageFromSelectionWithCharacters() {
    const selection = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    if (!selection || selection.length < 10) {
        showToast('请选择至少10个字的文本');
        return;
    }
    
    // 直接使用全局角色描述，不再传递参数
    await generateImageWithPrompt(selection, textarea.selectionStart, textarea.selectionEnd);
}

// 从当前章节生成图片（带角色设定）
async function generateImageFromChapterWithCharacters() {
    const text = textarea.value;
    if (!text || text.length < 10) {
        showToast('请先输入一些内容');
        return;
    }
    
    const chapterText = text.slice(-500);
    await generateImageWithPrompt(chapterText, 0, text.length);
}

// 通用的图片生成函数 - 完整版
async function generateImageWithPrompt(baseText, startPos, endPos) {
    showToast('正在生成图片...');
    
    try {
        // 直接使用全局角色描述
        const characters = storyMode.characterDescriptions || [];
        console.log('[WriterMode] 使用角色数量:', characters.length);
        
        // 不要在这里构建包含角色的提示词，直接传递原始文本
        console.log('[WriterMode] 原始文本:', baseText);
        
        // 生成图片提示词（generatePromptFromText 会自动添加角色描述）
        const prompt = await generatePromptFromText(baseText, characters);
        console.log('[WriterMode] 生成的提示词:', prompt);
        
        // 生成图片
        const imageUrl = await generateImage(prompt);
        console.log('[WriterMode] 生成的图片:', imageUrl);
        
        // 保存图片到 IndexedDB
        const imageRecord = await imageStorage.saveImage(storyMode.currentStoryId, {
            url: imageUrl,
            prompt: prompt,
            timestamp: Date.now(),
            isLocal: false
        });
        
        // 创建绑定
        const totalLength = textarea.value.length;
        const binding = {
            textRange: { start: startPos, end: endPos },
            startRatio: totalLength > 0 ? startPos / totalLength : 0,
            endRatio: totalLength > 0 ? endPos / totalLength : 1,
            imageUrl: imageUrl,
            imageId: imageRecord.id,
            prompt: prompt,
            timestamp: Date.now()
        };
        
        storyMode.imageBindings.push(binding);
        storyMode.images.push({
            id: imageRecord.id,
            url: imageUrl,
            prompt: prompt,
            timestamp: Date.now(),
            isLocal: false
        });
        
        storyMode.currentImageIndex = storyMode.images.length - 1;
        displayImage(imageUrl);
        updateImageList();
        await saveStoryData();
        
        showToast('图片生成成功！');
        
        // 恢复浮动按钮
        createFloatingButtons();
    } catch (error) {
        console.error('[WriterMode] 图片生成失败:', error);
        showToast('图片生成失败: ' + error.message);
        // 恢复浮动按钮
        createFloatingButtons();
    }
}


// 刷新本地图片
async function refreshLocalImages() {
    if (!writerConfig.localImagesEnabled || !storyMode.currentStoryId) return;
    
    try {
        console.log('[WriterMode] 刷新本地图片...');
        
        storyMode.images = storyMode.images.filter(img => !img.isLocal);
        
        const localImages = await localImageManager.loadLocalImages(storyMode.currentStoryId);
        
        storyMode.images = [...localImages, ...storyMode.images];
        
        updateImageDisplay();
        updateLocalImageStatus();
        
        console.log('[WriterMode] 本地图片刷新完成，总数:', storyMode.images.length);
    } catch (error) {
        console.error('[WriterMode] 刷新本地图片失败:', error);
    }
}

// 更新本地图片状态
function updateLocalImageStatus() {
    const statusIndicator = document.getElementById('local-image-status');
    if (!statusIndicator) return;
    
    const localImages = storyMode.images.filter(img => img.isLocal);
    if (localImages.length > 0) {
        statusIndicator.style.display = 'inline';
        statusIndicator.textContent = `📁 ${localImages.length}张本地图片`;
    } else {
        statusIndicator.style.display = 'none';
    }
}

// 创建头部
function createHeader() {
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 15px 30px;
        border-bottom: 1px solid rgba(0,255,255,0.3);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(10px);
        z-index: 10;
        min-height: 60px;
        flex-shrink: 0;
    `;
    
    const leftDiv = document.createElement('div');
    leftDiv.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    `;
    
    leftDiv.innerHTML = `
        <div style="font-size: 20px; color: #0ff; letter-spacing: 2px; white-space: nowrap;">
            ⚡ 作家模式 · <span style="color:#fff;">连环画创作终端</span>
        </div>
    `;
    
    const storyTitle = document.createElement('input');
    storyTitle.id = 'writer-story-title';
    storyTitle.value = storyMode.currentStoryId || '未命名故事';
    storyTitle.style.cssText = `
        background: rgba(10,20,30,0.8);
        border: 1px solid rgba(0,255,255,0.3);
        border-radius: 8px;
        color: #0ff;
        padding: 5px 10px;
        font-family: monospace;
        font-size: 14px;
        outline: none;
        width: 180px;
        min-width: 100px;
    `;
    storyTitle.onchange = async (e) => {
        const newTitle = e.target.value.trim();
        if (newTitle && newTitle !== storyMode.currentStoryId) {
            await saveContent();
            await saveStoryData();
            storyMode.currentStoryId = newTitle;
            storyMode.images = [];
            storyMode.imageBindings = [];
            localStorage.setItem('writer-mode-current-story', newTitle);
            await loadStoryData();
            await restoreContent();
            await refreshLocalImages();
        }
    };
    leftDiv.appendChild(storyTitle);
    
    const localImageStatus = document.createElement('span');
    localImageStatus.id = 'local-image-status';
    localImageStatus.style.cssText = `
        font-size: 12px;
        color: #0f0;
        display: none;
        white-space: nowrap;
    `;
    localImageStatus.textContent = '📁 本地图片已加载';
    leftDiv.appendChild(localImageStatus);

    // 添加模板按钮（在 leftDiv 中）
    // 注意：这里只创建按钮，实际添加到 header 在 openWriterMode 中处理
    
    const rightDiv = document.createElement('div');
    rightDiv.style.cssText = `
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
    `;
    
    // 在 createHeader 函数中，刷新图片按钮增加清空缓存功能
    const refreshBtn = document.createElement('button');
    refreshBtn.innerHTML = '🔄 刷新图片';
    refreshBtn.title = '刷新本地图片并清空缓存';
    refreshBtn.style.cssText = createButtonStyle('#0ff', 'rgba(0,255,255,0.2)');
    refreshBtn.onclick = async () => {
        // 清空缓存
        localImageManager.clearCache(storyMode.currentStoryId);
        // 重新加载
        await refreshLocalImages();
        showToast('✅ 已刷新本地图片');
    };
    rightDiv.appendChild(refreshBtn);
    
    const configBtn = document.createElement('button');
    configBtn.innerHTML = '⚙ 配置';
    configBtn.style.cssText = createButtonStyle('#0ff', 'rgba(0,255,255,0.2)');
    configBtn.onclick = openConfigModal;
    rightDiv.appendChild(configBtn);
    
    const historyBtn = document.createElement('button');
    historyBtn.innerHTML = '📚 历史';
    historyBtn.style.cssText = createButtonStyle('#0ff', 'rgba(0,255,255,0.2)');
    historyBtn.onclick = openHistoryModal;
    rightDiv.appendChild(historyBtn);
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: #0ff;
        font-size: 24px;
        cursor: pointer;
        padding: 0 10px;
    `;
    closeBtn.onclick = closeWriterMode;
    rightDiv.appendChild(closeBtn);
    
    header.appendChild(leftDiv);
    header.appendChild(rightDiv);
    
    return header;
}

// 创建写作区域
function createWritingArea() {
    const writingArea = document.createElement('div');
    writingArea.id = 'writer-text-area';
    writingArea.style.cssText = `
        flex: 1;
        padding: 20px;
        position: relative;
        transition: all 0.3s;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
    `;
    
    textarea = document.createElement('textarea');
    textarea.id = 'writer-textarea';
    textarea.spellcheck = false;
    textarea.autocorrect = 'off';
    textarea.autocapitalize = 'off';
    textarea.style.cssText = `
        flex: 1;
        width: 100%;
        background: rgba(10,20,30,0.8);
        border: 1px solid rgba(0,255,255,0.3);
        border-radius: 12px;
        padding: 25px;
        color: #ccf;
        font-family: 'Courier New', monospace;
        font-size: 16px;
        line-height: 1.8;
        resize: none;
        outline: none;
        backdrop-filter: blur(5px);
        box-sizing: border-box;
        min-height: 0;
    `;
    textarea.placeholder = '# 在此书写你的故事...\n\n灵感如星光闪烁，文字由你编织。\n点击「发送消息」唤醒AI，与你一同创作。';
    
    writingArea.appendChild(textarea);
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
        justify-content: center;
        padding: 10px 0;
        flex-shrink: 0;
    `;
    
    const sendBtn = document.createElement('button');
    sendBtn.id = 'writer-send-btn';
    sendBtn.textContent = '✧ 发送消息 ✧';
    sendBtn.style.cssText = `
        padding: 10px 24px;
        background: linear-gradient(135deg, rgba(0,200,255,0.2), rgba(0,100,200,0.3));
        border: 1px solid #0ff;
        color: #0ff;
        border-radius: 30px;
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 140px;
    `;
    sendBtn.onmouseenter = () => {
        sendBtn.style.transform = 'scale(1.05)';
        sendBtn.style.boxShadow = '0 0 15px rgba(0,255,255,0.3)';
    };
    sendBtn.onmouseleave = () => {
        sendBtn.style.transform = 'scale(1)';
        sendBtn.style.boxShadow = 'none';
    };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'writer-cancel-btn';
    cancelBtn.textContent = '⊗ 取消 ⊗';
    cancelBtn.disabled = true;
    cancelBtn.style.cssText = `
        padding: 10px 24px;
        background: rgba(30,30,50,0.6);
        border: 1px solid rgba(255,80,80,0.5);
        color: #f88;
        border-radius: 30px;
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 140px;
        opacity: 0.5;
    `;
    
    buttonContainer.appendChild(sendBtn);
    buttonContainer.appendChild(cancelBtn);
    
    writingArea.appendChild(buttonContainer);
    
    return writingArea;
}

// 创建图片区域
function createImageArea() {
    const imageArea = document.createElement('div');
    imageArea.id = 'writer-image-area';
    imageArea.style.cssText = `
        width: 50%;
        max-height: 100%;
        padding: 15px 15px 10px 15px;
        background: rgba(0,0,0,0.4);
        border-left: 1px solid rgba(0,255,255,0.3);
        display: flex;
        flex-direction: column;
        position: relative;
        min-width: 280px;
        box-sizing: border-box;
    `;

    // 工具栏
    const toolbar = document.createElement('div');
    toolbar.id = 'writer-image-toolbar';
    toolbar.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        padding: 4px 0 8px 0;
        flex-shrink: 0;
        flex-wrap: wrap;
    `;

    const infoLeft = document.createElement('div');
    infoLeft.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;color:#666;';
    infoLeft.innerHTML = `
        <span id="writer-img-index" style="color:#0ff;font-weight:bold;">0/0</span>
        <span id="writer-img-zoom-info" style="color:#888;">100%</span>
        <span id="writer-img-name" style="color:#555;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">无图片</span>
    `;
    toolbar.appendChild(infoLeft);

    const toolsRight = document.createElement('div');
    toolsRight.style.cssText = 'display:flex;align-items:center;gap:3px;flex-wrap:wrap;';

    const toolButtons = [
        { id: 'img-zoom-out', label: '➖', title: '缩小 (滚轮)' },
        { id: 'img-zoom-in', label: '➕', title: '放大 (滚轮)' },
        { id: 'img-fit', label: '⊡', title: '适应屏幕 (F)', cls: 'active' },
        { id: 'img-reset', label: '⟲', title: '重置视图' },
        { id: 'img-rotate', label: '↻', title: '旋转 (R)' },
        { id: 'img-magnifier', label: '🔍', title: '放大镜 (M)' },
        { id: 'img-fullscreen', label: '⛶', title: '全屏查看' },
    ];

    toolButtons.forEach(btn => {
        const el = document.createElement('button');
        el.id = btn.id;
        el.textContent = btn.label;
        el.title = btn.title;
        el.type = 'button';
        el.style.cssText = `
            width:28px;height:28px;border:none;border-radius:4px;
            background:rgba(255,255,255,0.04);color:#888;
            cursor:pointer;font-size:13px;
            transition:all 0.2s;font-family:monospace;
            display:flex;align-items:center;justify-content:center;
            pointer-events:auto;
        `;
        if (btn.cls) el.classList.add(btn.cls);
        el.onmouseenter = () => { el.style.background = 'rgba(255,255,255,0.08)'; el.style.color = '#fff'; };
        el.onmouseleave = () => { 
            if (!el.classList.contains('active')) {
                el.style.background = 'rgba(255,255,255,0.04)'; 
                el.style.color = '#888';
            }
        };
        toolsRight.appendChild(el);
    });

    toolbar.appendChild(toolsRight);
    imageArea.appendChild(toolbar);

    // 图片容器
    const viewerContainer = document.createElement('div');
    viewerContainer.id = 'writer-image-viewer';
    viewerContainer.style.cssText = `
        flex: 1;
        background: rgba(0,0,0,0.5);
        border: 1px solid rgba(0,255,255,0.15);
        border-radius: 10px;
        overflow: hidden;
        position: relative;
        min-height: 200px;
        cursor: grab;
        touch-action: none;
        pointer-events: auto;
    `;

    const placeholder = document.createElement('div');
    placeholder.id = 'writer-image-placeholder';
    placeholder.style.cssText = `
        position:absolute;top:0;left:0;width:100%;height:100%;
        display:flex;align-items:center;justify-content:center;
        color:rgba(0,255,255,0.3);font-size:14px;flex-direction:column;
        pointer-events:none;z-index:1;
    `;
    placeholder.innerHTML = `
        <div style="font-size:48px;margin-bottom:12px;">🖼️</div>
        <div>选择文本后生成图片</div>
        <div style="font-size:11px;margin-top:6px;color:rgba(255,255,255,0.2);">或加载本地图片</div>
    `;
    viewerContainer.appendChild(placeholder);

    const img = document.createElement('img');
    img.id = 'writer-current-image';
    img.style.cssText = `
        position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%) scale(1);
        max-width:100%;max-height:100%;
        object-fit:contain;display:none;
        will-change:transform;user-select:none;pointer-events:none;
        transition:none;
    `;
    img.draggable = false;
    viewerContainer.appendChild(img);

    // 在 createImageArea 中，修改放大镜的创建
    const magnifier = document.createElement('div');
    magnifier.id = 'writer-magnifier';
    magnifier.style.cssText = `
        display:none;
        position:absolute;
        pointer-events:none;
        border:2px solid rgba(0,255,255,0.5);
        border-radius:50%;
        overflow:hidden;
        background-color:rgba(0,0,0,0.8);
        background-repeat:no-repeat;
        box-shadow:0 0 40px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,0,0,0.3);
        z-index:20;
        transform:translate(-50%,-50%);
        width:180px;
        height:180px;
    `;

    // 添加十字线
    const crosshair = document.createElement('div');
    crosshair.style.cssText = `
        position:absolute;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        width:20px;
        height:20px;
        pointer-events:none;
        z-index:21;
    `;
    crosshair.innerHTML = `
        <div style="position:absolute;left:50%;top:0;width:1px;height:100%;background:rgba(0,255,255,0.5);transform:translateX(-50%);"></div>
        <div style="position:absolute;top:50%;left:0;height:1px;width:100%;background:rgba(0,255,255,0.5);transform:translateY(-50%);"></div>
    `;
    magnifier.appendChild(crosshair);

    viewerContainer.appendChild(magnifier);

    // 浮动控制面板
    const floatControls = document.createElement('div');
    floatControls.id = 'writer-float-controls';
    floatControls.style.cssText = `
        position:absolute;bottom:12px;right:12px;z-index:30;
        display:none;flex-direction:column;gap:8px;
        background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);
        padding:12px 16px;border-radius:10px;
        border:1px solid rgba(0,255,255,0.1);
        min-width:150px;box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `;
    floatControls.innerHTML = `
        <div style="font-size:11px;color:#0ff;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px;">🔍 放大镜控制</div>
        <div class="ctrl-row" style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:10px;color:#888;min-width:28px;">大小</label>
            <input type="range" id="writer-mag-size" min="60" max="512" value="360" step="10" style="flex:1;height:3px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.12);border-radius:2px;outline:none;min-width:60px;">
            <span class="val" id="writer-mag-size-val" style="font-size:10px;color:#0ff;min-width:30px;text-align:center;">360</span>
        </div>
        <div class="ctrl-row" style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:10px;color:#888;min-width:28px;">倍率</label>
            <input type="range" id="writer-mag-scale" min="1" max="50" value="20" step="1" style="flex:1;height:3px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.12);border-radius:2px;outline:none;min-width:60px;">
            <span class="val" id="writer-mag-scale-val" style="font-size:10px;color:#0ff;min-width:40px;text-align:center;">2.0x</span>
        </div>
        <div style="display:flex;gap:6px;justify-content:center;padding-top:4px;border-top:1px solid rgba(255,255,255,0.06);">
            <button id="writer-mag-reset" type="button" style="background:rgba(0,255,255,0.1);border:none;color:#0ff;padding:2px 12px;border-radius:4px;cursor:pointer;font-size:10px;font-family:monospace;pointer-events:auto;">↺ 重置</button>
            <button id="writer-mag-close" type="button" style="background:rgba(255,80,80,0.1);border:none;color:#f88;padding:2px 12px;border-radius:4px;cursor:pointer;font-size:10px;font-family:monospace;pointer-events:auto;">✕ 关闭</button>
        </div>
    `;
    viewerContainer.appendChild(floatControls);

    imageArea.appendChild(viewerContainer);

    // 图片列表
    const imageList = document.createElement('div');
    imageList.id = 'writer-image-list';
    imageList.style.cssText = `
        max-height:70px;overflow-y:auto;display:flex;flex-wrap:wrap;
        gap:8px;padding:8px 0 0 0;flex-shrink:0;
        align-items:center;
    `;
    imageArea.appendChild(imageList);

    return imageArea;
}

// ============================================================
// 图片查看器功能
// ============================================================

// index.js - 修复图片查看器的定位和缩放

// 修改 initImageViewer 函数中的关键部分
function initImageViewer() {
    const viewer = document.getElementById('writer-image-viewer');
    const img = document.getElementById('writer-current-image');
    const mag = document.getElementById('writer-magnifier');
    const magImg = document.getElementById('writer-mag-img');
    const floatControls = document.getElementById('writer-float-controls');
    const zoomInfo = document.getElementById('writer-img-zoom-info');

    if (!viewer) {
        console.warn('[WriterMode] 图片查看器元素不存在');
        return;
    }

    console.log('[WriterMode] 初始化图片查看器');

    // 更新容器尺寸
    function updateContainerSize() {
        const rect = viewer.getBoundingClientRect();
        imageViewerState.containerWidth = rect.width || 400;
        imageViewerState.containerHeight = rect.height || 500;
        console.log('[WriterMode] 容器尺寸:', imageViewerState.containerWidth, 'x', imageViewerState.containerHeight);
    }

    // 应用变换 - 修复版
    function applyTransform() {
        if (!img) return;
        const state = imageViewerState;
        
        // 计算缩放后的图片尺寸
        const scaledWidth = state.naturalWidth * state.scale;
        const scaledHeight = state.naturalHeight * state.scale;
        
        // 计算容器中心
        const centerX = state.containerWidth / 2;
        const centerY = state.containerHeight / 2;
        
        // 计算图片位置
        let posX, posY;
        
        if (state.fitMode) {
            // 适应模式：图片居中
            posX = centerX;
            posY = centerY;
        } else {
            // 手动模式：基于拖拽偏移
            posX = centerX + state.translateX;
            posY = centerY + state.translateY;
            
            // 限制拖拽范围
            const maxTX = Math.max(0, (scaledWidth - state.containerWidth) / 2);
            const maxTY = Math.max(0, (scaledHeight - state.containerHeight) / 2);
            state.translateX = Math.max(-maxTX, Math.min(maxTX, state.translateX));
            state.translateY = Math.max(-maxTY, Math.min(maxTY, state.translateY));
            posX = centerX + state.translateX;
            posY = centerY + state.translateY;
        }
        
        // 设置图片样式
        img.style.position = 'absolute';
        img.style.left = posX + 'px';
        img.style.top = posY + 'px';
        img.style.transform = `translate(-50%, -50%) scale(${state.scale}) rotate(${state.rotation}deg)`;
        img.style.transformOrigin = 'center center';
        
        // 设置图片尺寸
        img.style.width = state.naturalWidth + 'px';
        img.style.height = state.naturalHeight + 'px';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        
        if (zoomInfo) {
            zoomInfo.textContent = Math.round(state.scale * 100) + '%';
        }
        if (state.magnifierActive) updateMagnifier();
    }

    // 适应屏幕 - 修复版
    function fitToScreen() {
        const state = imageViewerState;
        if (state.naturalWidth === 0 || !state.imageLoaded) return;
        
        updateContainerSize();
        
        // 计算适应屏幕的缩放比例
        const paddingX = state.containerWidth * 0.05; // 5% padding
        const paddingY = state.containerHeight * 0.05;
        const availableWidth = state.containerWidth - paddingX * 2;
        const availableHeight = state.containerHeight - paddingY * 2;
        
        const sx = availableWidth / state.naturalWidth;
        const sy = availableHeight / state.naturalHeight;
        
        // 取较小值确保图片完全可见
        state.scale = Math.min(sx, sy);
        
        // 限制最大缩放为1（不放大超过原始尺寸）
        // state.scale = Math.min(state.scale, 1);
        
        state.translateX = 0;
        state.translateY = 0;
        state.fitMode = true;
        state.rotation = 0;
        
        applyTransform();
        
        const fitBtn = document.getElementById('img-fit');
        if (fitBtn) {
            fitBtn.classList.add('active');
            fitBtn.style.background = 'rgba(0,255,255,0.15)';
            fitBtn.style.color = '#0ff';
        }
        
        console.log('[WriterMode] 适应屏幕缩放:', state.scale);
    }

    // 缩放 - 修复版
    function setScale(newScale, cx, cy) {
        const state = imageViewerState;
        newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));
        
        if (state.fitMode) {
            state.fitMode = false;
            const fitBtn = document.getElementById('img-fit');
            if (fitBtn) {
                fitBtn.classList.remove('active');
                fitBtn.style.background = 'rgba(255,255,255,0.04)';
                fitBtn.style.color = '#888';
            }
        }
        
        // 如果提供了鼠标位置，以鼠标位置为中心缩放
        if (cx !== undefined && cy !== undefined) {
            const rect = viewer.getBoundingClientRect();
            const mouseX = cx - rect.left;
            const mouseY = cy - rect.top;
            
            // 计算鼠标相对于图片中心的位置
            const centerX = state.containerWidth / 2;
            const centerY = state.containerHeight / 2;
            const offsetX = mouseX - centerX - state.translateX;
            const offsetY = mouseY - centerY - state.translateY;
            
            // 调整平移以保持鼠标位置不变
            const scaleRatio = newScale / state.scale;
            state.translateX -= offsetX * (scaleRatio - 1);
            state.translateY -= offsetY * (scaleRatio - 1);
        }
        
        state.scale = newScale;
        applyTransform();
        if (state.magnifierActive) updateMagnifier();
    }

    function zoomStep(factor) {
        setScale(imageViewerState.scale * factor);
    }

    // 重置 - 修复版
    function resetView() {
        imageViewerState.rotation = 0;
        fitToScreen();
        if (imageViewerState.magnifierActive) setTimeout(updateMagnifier, 50);
    }

    // 旋转 - 修复版
    function rotateImage() {
        imageViewerState.rotation = (imageViewerState.rotation + 90) % 360;
        applyTransform();
        if (imageViewerState.magnifierActive) setTimeout(updateMagnifier, 50);
    }

    // 切换适应 - 修复版
    function toggleFit() {
        if (imageViewerState.fitMode) {
            imageViewerState.fitMode = false;
            const fitBtn = document.getElementById('img-fit');
            if (fitBtn) {
                fitBtn.classList.remove('active');
                fitBtn.style.background = 'rgba(255,255,255,0.04)';
                fitBtn.style.color = '#888';
            }
            applyTransform();
        } else {
            fitToScreen();
        }
    }

    // 放大镜 - 保持不变
    function toggleMagnifier() {
        const state = imageViewerState;
        if (!state.imageLoaded) {
            showToast('请先加载图片');
            return;
        }
        state.magnifierActive = !state.magnifierActive;
        const magEl = document.getElementById('writer-magnifier');
        const controls = document.getElementById('writer-float-controls');
        const btn = document.getElementById('img-magnifier');
        const viewerEl = document.getElementById('writer-image-viewer');
    
        if (state.magnifierActive) {
            if (btn) {
                btn.classList.add('active');
                btn.style.background = 'rgba(0,255,255,0.15)';
                btn.style.color = '#0ff';
            }
            if (controls) controls.style.display = 'flex';
            if (viewerEl) viewerEl.style.cursor = 'crosshair';
            if (magEl) {
                magEl.style.display = 'block';
                magEl.style.width = state.magnifierSize + 'px';
                magEl.style.height = state.magnifierSize + 'px';
            }
            const sizeSlider = document.getElementById('writer-mag-size');
            const scaleSlider = document.getElementById('writer-mag-scale');
            if (sizeSlider) sizeSlider.value = state.magnifierSize;
            if (scaleSlider) scaleSlider.value = Math.round(state.magnifyScale * 10);  // 转换为滑块值
            updateMagnifierSizeDisplay();
            updateMagnifierScaleDisplay();
            const rect = viewerEl?.getBoundingClientRect();
            state._lastMouseX = rect ? rect.left + rect.width / 2 : 0;
            state._lastMouseY = rect ? rect.top + rect.height / 2 : 0;
            setTimeout(updateMagnifier, 30);
        } else {
            if (btn) {
                btn.classList.remove('active');
                btn.style.background = 'rgba(255,255,255,0.04)';
                btn.style.color = '#888';
            }
            if (controls) controls.style.display = 'none';
            if (viewerEl) viewerEl.style.cursor = 'grab';
            if (magEl) magEl.style.display = 'none';
        }
    }
    function updateMagnifierScaleDisplay() {
        const val = document.getElementById('writer-mag-scale-val');
        const slider = document.getElementById('writer-mag-scale');
        if (val && slider) {
            const sliderValue = parseInt(slider.value);
            const actualScale = sliderValue / 10;  // 1-500 转换为 0.1-50.0
            val.textContent = actualScale.toFixed(1) + 'x';  // 显示为 "0.5x", "2.0x", "10.0x"
            imageViewerState.magnifyScale = actualScale;
        }
    }
    // 更新放大镜 - 修复版
    function updateMagnifier() {
        const state = imageViewerState;
        const magEl = document.getElementById('writer-magnifier');
        const viewerEl = document.getElementById('writer-image-viewer');
        const imgEl = document.getElementById('writer-current-image');
        
        if (!magEl || !viewerEl || !imgEl) return;
        
        // 如果放大镜未激活或图片未加载，隐藏放大镜
        if (!state.magnifierActive || !state.imageLoaded) {
            magEl.style.display = 'none';
            return;
        }
        
        // 获取鼠标位置
        const mouseX = state._lastMouseX;
        const mouseY = state._lastMouseY;
        
        if (mouseX === undefined || mouseY === undefined) return;
        
        // 获取查看器的边界
        const viewerRect = viewerEl.getBoundingClientRect();
        
        // 计算鼠标相对于查看器的位置
        const relX = mouseX - viewerRect.left;
        const relY = mouseY - viewerRect.top;
        
        // 检查鼠标是否在查看器内
        if (relX < 0 || relY < 0 || relX > viewerRect.width || relY > viewerRect.height) {
            magEl.style.display = 'none';
            return;
        }
        
        // 获取图片的实际位置
        const imgRect = imgEl.getBoundingClientRect();
        
        // 检查图片是否可见
        if (imgRect.width === 0 || imgRect.height === 0) {
            magEl.style.display = 'none';
            return;
        }
        
        // 计算鼠标在图片上的相对位置（0-1范围）
        const imgRelX = (mouseX - imgRect.left) / imgRect.width;
        const imgRelY = (mouseY - imgRect.top) / imgRect.height;
        
        // 检查鼠标是否在图片上
        if (imgRelX < 0 || imgRelY < 0 || imgRelX > 1 || imgRelY > 1) {
            magEl.style.display = 'none';
            return;
        }
        
        // 显示放大镜
        magEl.style.display = 'block';
        
        // 设置放大镜大小和位置
        const magSize = state.magnifierSize;
        magEl.style.width = magSize + 'px';
        magEl.style.height = magSize + 'px';
        magEl.style.left = relX + 'px';
        magEl.style.top = relY + 'px';
        
        // 使用用户设置的倍率（支持小数，如 0.5 表示缩小）
        const magnification = state.magnifyScale;
        
        // 使用 background-image 方式显示内容
        magEl.style.backgroundImage = `url('${imgEl.src}')`;
        magEl.style.backgroundSize = `${state.naturalWidth * magnification}px ${state.naturalHeight * magnification}px`;
        magEl.style.backgroundRepeat = 'no-repeat';
        
        // 计算背景位置
        // 当 magnification < 1 时，显示的是缩小的图片
        // 当 magnification > 1 时，显示的是放大的图片
        const bgX = magSize / 2 - imgRelX * state.naturalWidth * magnification;
        const bgY = magSize / 2 - imgRelY * state.naturalHeight * magnification;
        
        magEl.style.backgroundPosition = `${bgX}px ${bgY}px`;
        
        // 隐藏原来的 img 元素（如果有）
        const magImgEl = document.getElementById('writer-mag-img');
        if (magImgEl) {
            magImgEl.style.display = 'none';
        }
    }
    

    // 设置图片 - 修复版
    // 改为 async 函数
async function setImageViewerImage(url) {
    const state = imageViewerState;
    const imgEl = document.getElementById('writer-current-image');
    const placeholderEl = document.getElementById('writer-image-placeholder');
    
    if (!imgEl) return;

    state.imageLoaded = false;
    state.currentUrl = url;

    if (!url || url === 'undefined' || url === 'null' || url === 'data:image/png;base64,') {
        imgEl.style.display = 'none';
        if (placeholderEl) {
            placeholderEl.style.display = 'flex';
            placeholderEl.innerHTML = `
                <div style="font-size:48px;margin-bottom:12px;">🖼️</div>
                <div>选择文本后生成图片</div>
            `;
        }
        return;
    }

    // 显示加载状态
    if (placeholderEl) {
        placeholderEl.style.display = 'flex';
        placeholderEl.innerHTML = `<div>⏳ 加载图片中...</div>`;
    }
    imgEl.style.display = 'none';

    // 清理旧事件和旧 URL
    imgEl.onload = null;
    imgEl.onerror = null;
    if (imgEl.src && imgEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(imgEl.src);
    }

    // 如果是 Base64 数据，转换为 Blob URL
    let finalUrl = url;
    if (url.startsWith('data:image')) {
        try {
            // 从 Base64 创建 Blob
            const response = await fetch(url);
            const blob = await response.blob();
            finalUrl = URL.createObjectURL(blob);
            console.log('[WriterMode] Base64 转换为 Blob URL，大小:', (blob.size / 1024).toFixed(2), 'KB');
        } catch (e) {
            console.error('[WriterMode] Base64 转换失败，尝试直接加载:', e);
            finalUrl = url;
        }
    }

    imgEl.onload = function() {
        state.naturalWidth = imgEl.naturalWidth;
        state.naturalHeight = imgEl.naturalHeight;
        state.imageLoaded = true;
        if (placeholderEl) placeholderEl.style.display = 'none';
        imgEl.style.display = 'block';
        
        updateContainerSize();
        fitToScreen();
        
        const nameEl = document.getElementById('writer-img-name');
        if (nameEl) {
            if (url.startsWith('data:image')) {
                nameEl.textContent = 'AI生成图片';
            } else {
                nameEl.textContent = url.split('/').pop()?.slice(0, 20) || '图片';
            }
        }
        updateImageIndex();
        console.log('[WriterMode] 图片加载成功');
    };

    imgEl.onerror = function(e) {
        console.error('[WriterMode] 图片加载失败');
        state.imageLoaded = false;
        imgEl.style.display = 'none';
        
        if (placeholderEl) {
            placeholderEl.style.display = 'flex';
            placeholderEl.innerHTML = `
                <div style="font-size:32px;color:#ea4335;margin-bottom:8px;">❌</div>
                <div style="color:#ea4335;">图片加载失败</div>
                <div style="font-size:11px;margin-top:8px;color:rgba(255,255,255,0.3);">
                    请尝试重新生成
                </div>
                <button onclick="window.retryLastImage()" style="
                    margin-top:12px;padding:6px 16px;
                    background:rgba(255,50,50,0.2);
                    border:1px solid #ea4335;
                    color:#ea4335;border-radius:6px;
                    cursor:pointer;font-family:monospace;
                    pointer-events:auto;
                ">重新生成</button>
            `;
        }
    };

    // 设置图片源
    imgEl.src = finalUrl;
}

    function updateImageIndex() {
        const el = document.getElementById('writer-img-index');
        if (!el) return;
        const total = storyMode.images.length;
        const current = storyMode.currentImageIndex + 1;
        el.textContent = total > 0 ? `${current}/${total}` : '0/0';
    }

    // 绑定按钮事件
    const zoomInBtn = document.getElementById('img-zoom-in');
    const zoomOutBtn = document.getElementById('img-zoom-out');
    const resetBtn = document.getElementById('img-reset');
    const fitBtn = document.getElementById('img-fit');
    const rotateBtn = document.getElementById('img-rotate');
    const magnifierBtn = document.getElementById('img-magnifier');
    const fullscreenBtn = document.getElementById('img-fullscreen');

    if (zoomInBtn) {
        zoomInBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[WriterMode] 放大按钮点击');
            zoomStep(1.2);
        };
    }
    if (zoomOutBtn) {
        zoomOutBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[WriterMode] 缩小按钮点击');
            zoomStep(0.8);
        };
    }
    if (resetBtn) {
        resetBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[WriterMode] 重置按钮点击');
            resetView();
        };
    }
    if (fitBtn) {
        fitBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[WriterMode] 适应按钮点击');
            toggleFit();
        };
    }
    if (rotateBtn) {
        rotateBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[WriterMode] 旋转按钮点击');
            rotateImage();
        };
    }
    if (magnifierBtn) {
        magnifierBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[WriterMode] 放大镜按钮点击');
            toggleMagnifier();
        };
    }
    if (fullscreenBtn) {
        fullscreenBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[WriterMode] 全屏按钮点击');
            toggleFullscreen();
        };
    }

    // 拖拽事件 - 修复版
    viewer.addEventListener('mousedown', function(e) {
        const state = imageViewerState;
        if (!state.imageLoaded || state.magnifierActive) return;
        state.isDragging = true;
        state.dragStartX = e.clientX;
        state.dragStartY = e.clientY;
        state.dragStartTX = state.translateX;
        state.dragStartTY = state.translateY;
        viewer.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        const state = imageViewerState;
        state._lastMouseX = e.clientX;
        state._lastMouseY = e.clientY;
        if (state.magnifierActive && state.imageLoaded) {
            updateMagnifier();
            return;
        }
        if (!state.isDragging || !state.imageLoaded) return;
        const dx = e.clientX - state.dragStartX;
        const dy = e.clientY - state.dragStartY;
        state.translateX = state.dragStartTX + dx;
        state.translateY = state.dragStartTY + dy;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            if (state.fitMode) {
                state.fitMode = false;
                const fitBtnEl = document.getElementById('img-fit');
                if (fitBtnEl) {
                    fitBtnEl.classList.remove('active');
                    fitBtnEl.style.background = 'rgba(255,255,255,0.04)';
                    fitBtnEl.style.color = '#888';
                }
            }
        }
        applyTransform();
    });

    document.addEventListener('mouseup', function() {
        const state = imageViewerState;
        if (state.isDragging) {
            state.isDragging = false;
            const viewerEl = document.getElementById('writer-image-viewer');
            if (viewerEl) viewerEl.style.cursor = state.magnifierActive ? 'crosshair' : 'grab';
        }
    });

    // 滚轮缩放 - 修复版
    viewer.addEventListener('wheel', function(e) {
        const state = imageViewerState;
        if (!state.imageLoaded) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setScale(state.scale * delta, e.clientX, e.clientY);
    }, { passive: false });

    // 键盘快捷键
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const state = imageViewerState;
        if (!state.imageLoaded) return;
        if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMagnifier(); return; }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotateImage(); return; }
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFit(); return; }
    });

    // 窗口大小变化
    window.addEventListener('resize', function() {
        const state = imageViewerState;
        if (!state.imageLoaded) return;
        updateContainerSize();
        if (state.fitMode) fitToScreen();
        else applyTransform();
        if (state.magnifierActive) setTimeout(updateMagnifier, 100);
    });

    // 放大镜控制
    const magSizeSlider = document.getElementById('writer-mag-size');
    const magScaleSlider = document.getElementById('writer-mag-scale');
    const magResetBtn = document.getElementById('writer-mag-reset');
    const magCloseBtn = document.getElementById('writer-mag-close');

    if (magScaleSlider) {
        magScaleSlider.oninput = function() {
            const sliderValue = parseInt(this.value);
            const actualScale = sliderValue / 10;  // 转换为实际倍率
            const valDisplay = document.getElementById('writer-mag-scale-val');
            if (valDisplay) valDisplay.textContent = actualScale.toFixed(1) + 'x';
            imageViewerState.magnifyScale = actualScale;
            if (imageViewerState.magnifierActive) updateMagnifier();
        };
    }
    
    // 7. 修改重置按钮
    if (magResetBtn) {
        magResetBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            imageViewerState.magnifierSize = 360;
            imageViewerState.magnifyScale = 2.0;  // 重置为2.0倍
            const sizeSlider = document.getElementById('writer-mag-size');
            const scaleSlider = document.getElementById('writer-mag-scale');
            if (sizeSlider) sizeSlider.value = 360;
            if (scaleSlider) scaleSlider.value = 20;  // 20 对应 2.0x
            const sizeVal = document.getElementById('writer-mag-size-val');
            const scaleVal = document.getElementById('writer-mag-scale-val');
            if (sizeVal) sizeVal.textContent = '360';
            if (scaleVal) scaleVal.textContent = '2.0x';
            if (imageViewerState.magnifierActive) {
                const magEl = document.getElementById('writer-magnifier');
                if (magEl) { magEl.style.width = '360px'; magEl.style.height = '360px'; }
                updateMagnifier();
            }
        };
    }

    if (magCloseBtn) {
        magCloseBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (imageViewerState.magnifierActive) toggleMagnifier();
        };
    }

    // 暴露全局方法
    window.imageViewer = {
        setImage: setImageViewerImage,
        fitToScreen: fitToScreen,
        resetView: resetView,
        toggleFit: toggleFit,
        rotateImage: rotateImage,
        toggleMagnifier: toggleMagnifier,
        updateIndex: updateImageIndex,
        getState: () => imageViewerState,
        zoomIn: () => zoomStep(1.2),
        zoomOut: () => zoomStep(0.8)
    };

    console.log('[WriterMode] 图片查看器初始化完成');
}

// 显示图片
// 修改 displayImage 函数
function displayImage(url) {
    // 确保 imageViewer 已初始化
    if (window.imageViewer && window.imageViewer.setImage) {
        window.imageViewer.setImage(url);
    } else {
        // 如果 imageViewer 未初始化，尝试使用全局函数
        if (typeof setImageViewerImage === 'function') {
            setImageViewerImage(url);
        } else {
            console.warn('[WriterMode] 图片查看器未初始化，跳过显示');
            // 直接设置图片元素
            const imgEl = document.getElementById('writer-current-image');
            if (imgEl && url) {
                imgEl.src = url;
                imgEl.style.display = 'block';
                const placeholder = document.getElementById('writer-image-placeholder');
                if (placeholder) placeholder.style.display = 'none';
            }
        }
    }
    if (window.imageViewer && window.imageViewer.updateIndex) {
        window.imageViewer.updateIndex();
    }
}

// 更新图片显示
function updateImageDisplay() {
    if (storyMode.images.length > 0) {
        if (storyMode.currentImageIndex >= storyMode.images.length) {
            storyMode.currentImageIndex = 0;
        }
        const image = storyMode.images[storyMode.currentImageIndex];
        displayImage(image.url);
    } else {
        displayImage(null);
    }
    updateImageList();
}

// 切换图片
function switchImage(direction) {
    if (storyMode.images.length === 0) return;
    storyMode.currentImageIndex += direction;
    if (storyMode.currentImageIndex < 0) {
        storyMode.currentImageIndex = storyMode.images.length - 1;
    } else if (storyMode.currentImageIndex >= storyMode.images.length) {
        storyMode.currentImageIndex = 0;
    }
    const image = storyMode.images[storyMode.currentImageIndex];
    displayImage(image.url);
    updateImageList();
}

// 更新图片列表
function updateImageList() {
    const imageList = document.getElementById('writer-image-list');
    if (!imageList) return;
    
    imageList.innerHTML = '';
    
    storyMode.images.forEach((image, index) => {
        const thumbContainer = document.createElement('div');
        thumbContainer.style.cssText = `
            position: relative;
            width: 60px;
            height: 60px;
            display: inline-block;
            flex-shrink: 0;
        `;
        
        const thumb = document.createElement('img');
        thumb.src = image.url;
        thumb.style.cssText = `
            width: 60px;
            height: 60px;
            object-fit: cover;
            border-radius: 8px;
            cursor: pointer;
            border: 2px solid ${index === storyMode.currentImageIndex ? '#0ff' : 'transparent'};
            transition: all 0.2s;
            display: block;
        `;
        thumb.onclick = () => {
            storyMode.currentImageIndex = index;
            displayImage(image.url);
            updateImageList();
        };
        thumb.onmouseenter = () => {
            thumb.style.transform = 'scale(1.1)';
        };
        thumb.onmouseleave = () => {
            thumb.style.transform = 'scale(1)';
        };
        
        if (image.isLocal) {
            const localBadge = document.createElement('span');
            localBadge.textContent = '📁';
            localBadge.title = '本地图片';
            localBadge.style.cssText = `
                position: absolute;
                bottom: 2px;
                left: 2px;
                font-size: 10px;
                background: rgba(0,0,0,0.7);
                border-radius: 3px;
                padding: 1px 2px;
                z-index: 5;
            `;
            thumbContainer.appendChild(localBadge);
        }
        
        if (!image.isLocal) {
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '✕';
            deleteBtn.title = '删除图片';
            deleteBtn.type = 'button';
            deleteBtn.style.cssText = `
                position: absolute;
                top: -5px;
                right: -5px;
                width: 20px;
                height: 20px;
                background: rgba(255,0,0,0.8);
                border: 1px solid #fff;
                border-radius: 50%;
                color: #fff;
                font-size: 10px;
                line-height: 1;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                z-index: 10;
            `;
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                await deleteImage(index);
            };
            thumbContainer.appendChild(deleteBtn);
        }
        
        thumbContainer.appendChild(thumb);
        imageList.appendChild(thumbContainer);
    });
    
    // 更新索引显示
    if (window.imageViewer && window.imageViewer.updateIndex) {
        window.imageViewer.updateIndex();
    }
}

// 删除图片
async function deleteImage(index) {
    if (index < 0 || index >= storyMode.images.length) return;
    
    const image = storyMode.images[index];
    
    if (image.isLocal) {
        showToast('本地图片无法在界面中删除，请直接在文件夹中删除');
        return;
    }
    
    try {
        if (image.id) {
            await imageStorage.deleteImage(image.id);
        }
        
        storyMode.images.splice(index, 1);
        
        storyMode.imageBindings = storyMode.imageBindings.filter(
            binding => binding.imageUrl !== image.url
        );
        
        if (storyMode.currentImageIndex >= storyMode.images.length) {
            storyMode.currentImageIndex = Math.max(0, storyMode.images.length - 1);
        }
        
        if (storyMode.images.length > 0) {
            displayImage(storyMode.images[storyMode.currentImageIndex].url);
        } else {
            displayImage(null);
        }
        
        updateImageList();
        await saveStoryData();
        
        showToast('图片已删除');
    } catch (error) {
        console.error('[WriterMode] 删除图片失败:', error);
        showToast('删除图片失败: ' + error.message);
    }
}

// 创建按钮样式
function createButtonStyle(color, bg) {
    return `
        padding: 8px 15px;
        background: ${bg};
        border: 1px solid ${color};
        color: ${color};
        border-radius: 20px;
        cursor: pointer;
        font-family: monospace;
        font-size: 12px;
        transition: all 0.2s;
        pointer-events: auto;
    `;
}

// 创建状态指示器
function createStatusIndicator() {
    const statusIndicator = document.createElement('div');
    statusIndicator.id = 'writer-status';
    statusIndicator.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        display: none;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: rgba(0,0,0,0.8);
        border-radius: 20px;
        border: 1px solid rgba(0,255,255,0.5);
        z-index: 1000001;
        font-family: monospace;
        font-size: 12px;
        color: #0ff;
        backdrop-filter: blur(10px);
    `;
    statusIndicator.innerHTML = `
        <span class="dot" style="
            width: 6px;
            height: 6px;
            background: #0ff;
            border-radius: 50%;
            display: inline-block;
            animation: pulse 1s infinite;
        "></span>
        <span>AI 正在流式创作中...</span>
        <style>
            @keyframes pulse {
                0%, 100% { opacity: 0.2; transform: scale(0.8); }
                50% { opacity: 1; transform: scale(1.2); }
            }
        </style>
    `;
    return statusIndicator;
}

// 绑定事件
function bindEvents() {
    const sendBtn = document.getElementById('writer-send-btn');
    const cancelBtn = document.getElementById('writer-cancel-btn');
    
    if (sendBtn) sendBtn.onclick = onSendMessage;
    if (cancelBtn) cancelBtn.onclick = cancelGeneration;
    
    if (textarea) {
        textarea.onkeydown = (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                onSendMessage();
            } else if (e.key === 'Escape') {
                if (isGenerating) cancelGeneration();
                else closeWriterMode();
            }
        };
        
        // textarea.onscroll = handleScroll;
        textarea.onmouseup = handleTextSelection;
    }
    
    // 自动保存
    setInterval(async () => {
        await saveContent();
        await saveStoryData();
    }, 30000);
}

// 处理滚动
function handleScroll() {
    if (!writerConfig.storyboardMode || !writerConfig.autoBind) return;
    
    const scrollTop = textarea.scrollTop;
    const scrollHeight = textarea.scrollHeight;
    const clientHeight = textarea.clientHeight;
    
    if (scrollHeight <= clientHeight) return;
    
    const scrollRatio = scrollTop / (scrollHeight - clientHeight);
    
    let targetImage = null;
    for (const binding of storyMode.imageBindings) {
        if (binding.startRatio <= scrollRatio && scrollRatio <= binding.endRatio) {
            targetImage = binding;
            break;
        }
    }
    
    if (targetImage) {
        const currentImg = document.getElementById('writer-current-image');
        if (currentImg && currentImg.src !== targetImage.imageUrl) {
            displayImage(targetImage.imageUrl);
        }
    }
}

// 处理文本选择
function handleTextSelection() {
    const selection = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    if (selection && selection.length > 10) {
        // 不自动显示浮动按钮，因为已经有固定的浮动按钮了
        // 可以显示一个小提示
        showSelectionHint();
    }
}

// 显示选择提示
function showSelectionHint() {
    const existingHint = document.getElementById('selection-hint');
    if (existingHint) existingHint.remove();
    
    const hint = document.createElement('div');
    hint.id = 'selection-hint';
    hint.textContent = '✨ 已选择文本，可点击右侧"AI生成图片"按钮';
    hint.style.cssText = `
        position: fixed;
        bottom: 150px;
        right: 20px;
        background: rgba(0,0,0,0.8);
        color: #0ff;
        padding: 8px 12px;
        border-radius: 15px;
        border: 1px solid rgba(0,255,255,0.5);
        font-family: monospace;
        font-size: 11px;
        z-index: 1000001;
        pointer-events: none;
        animation: fadeIn 0.3s;
    `;
    document.body.appendChild(hint);
    
    setTimeout(() => {
        if (hint.parentNode) hint.remove();
    }, 2000);
}

// 显示浮动生成按钮
function showFloatingGenerateButton() {
    const existingBtn = document.getElementById('floating-gen-btn');
    if (existingBtn) existingBtn.remove();
    
    const btn = document.createElement('button');
    btn.id = 'floating-gen-btn';
    btn.textContent = '🎨 为此段生成图片';
    btn.type = 'button';
    btn.style.cssText = `
        position: fixed;
        bottom: 100px;
        right: ${writerConfig.storyboardMode ? '430px' : '30px'};
        background: rgba(0,255,255,0.9);
        border: none;
        color: #000;
        padding: 8px 16px;
        border-radius: 20px;
        cursor: pointer;
        font-family: monospace;
        font-size: 12px;
        z-index: 1000001;
        box-shadow: 0 0 20px rgba(0,255,255,0.5);
        pointer-events: auto;
    `;
    btn.onclick = generateImageFromSelection;
    document.body.appendChild(btn);
    
    setTimeout(() => {
        if (btn.parentNode) btn.remove();
    }, 3000);
}

// 从选择文本生成图片
async function generateImageFromSelection() {
    openGenerateImagePanel();
}

// 从文本生成提示词
// 修改 generatePromptFromText 函数
async function generatePromptFromText(text, characterDescriptions = null) {
    const url = writerConfig.apiType === 'local' 
        ? `${writerConfig.koboldcppUrl}/api/v1/generate`
        : writerConfig.remoteApiUrl;
    
    // 原有的提示词构建逻辑保持不变
    const chars = characterDescriptions || storyMode.characterDescriptions || [];
    let characterPrompt = '';
    if (chars.length > 0) {
        characterPrompt = 'Character descriptions (must strictly follow these descriptions):\n';
        chars.forEach(char => {
            characterPrompt += `- ${char.name}: ${char.description}\n`;
        });
        characterPrompt += '\n';
    }
    
    // 保持原有的system prompt
    const systemPrompt = `USER:
You are a visual novel scene generator.
Based on the current storyline and the character descriptions provided below, generate a detailed English scene description suitable for image creation.
The content should include: scene environment, atmosphere, and visual style.
Use the character descriptions to maintain consistency in appearance. The characters must look exactly as described.
The language should be concise and vivid. Only output the prompt.

${characterPrompt}[Story Context]
${text}

AI:
`;
    
    // 根据API类型调用不同的生成方法
    if (writerConfig.apiType === 'local') {
        return await generatePromptLocal(systemPrompt);
    } else {
        return await generatePromptRemote(systemPrompt);
    }
}

async function generatePromptLocal(prompt) {
    const payload = {
        prompt: prompt,
        max_length: 500,
        temperature: 0.7,
        top_p: 0.9,
        rep_pen: 1.1
    };
    
    const response = await fetch(`${writerConfig.koboldcppUrl}/api/v1/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error(`KoboldCPP API错误: ${response.status}`);
    }
    
    const data = await response.json();
    return data.results?.[0]?.text || '';
}

async function generatePromptRemote(prompt) {
    const provider = writerConfig.remoteProvider;
    const url = writerConfig.remoteApiUrl;
    const key = writerConfig.apiKey;
    const model = writerConfig.remoteModel;
    
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (provider === 'claude') {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
    } else if (key) {
        headers['Authorization'] = `Bearer ${key}`;
    }
    
    let body;
    if (provider === 'claude') {
        body = {
            model: model || 'claude-3-sonnet-20240229',
            max_tokens: 500,
            system: "You are a visual novel scene generator. Generate detailed scene descriptions.",
            messages: [
                { role: 'user', content: prompt }
            ]
        };
    } else {
        body = {
            model: model || 'gpt-3.5-turbo',
            max_tokens: 500,
            temperature: 0.7,
            messages: [
                { role: 'user', content: prompt }
            ]
        };
    }
    
    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`远程API错误 (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    let content = '';
    
    if (provider === 'claude') {
        content = data.content?.[0]?.text || '';
    } else {
        content = data.choices?.[0]?.message?.content || '';
    }
    
    return content.trim();
}

// 生成图片
async function generateImage(prompt) {
    // 获取当前工作流
    let workflow = workflowManager.currentWorkflow?.workflow;
    let promptNodeId = workflowManager.currentWorkflow?.promptNode || '11';
    let promptField = workflowManager.currentWorkflow?.promptField || 'text';
    
    // 如果没有工作流，使用默认
    if (!workflow) {
        workflow = JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
        promptNodeId = '11';
        promptField = 'text';
    } else {
        workflow = JSON.parse(JSON.stringify(workflow));
    }
    
    // 设置提示词
    if (workflow[promptNodeId] && workflow[promptNodeId].inputs) {
        workflow[promptNodeId].inputs[promptField] = "anime coloring,@kurono mitsuki, @love cacao, @liduke,\n" + prompt;
    } else {
        // 回退到默认
        if (workflow["11"]) {
            workflow["11"]["inputs"]["text"] = "anime coloring,@kurono mitsuki, @love cacao, @liduke,\n" + prompt;
        }
    }
    
    // 更新种子（如果存在）
    const seedNodes = ['19', 'KSampler'];
    for (const [nodeId, nodeData] of Object.entries(workflow)) {
        if (nodeData.class_type === 'KSampler' || nodeData.class_type === 'KSamplerAdvanced') {
            if (nodeData.inputs && nodeData.inputs.seed !== undefined) {
                nodeData.inputs.seed = Math.floor(Math.random() * 2147483647);
            }
        }
    }
    
    const clientId = generateUUID();
    const wsUrl = `ws://${writerConfig.comfyuiUrl}/ws?clientId=${clientId}`;
    const ws = new WebSocket(wsUrl);
    
    return new Promise((resolve, reject) => {
        ws.onopen = async () => {
            try {
                const promptId = generateUUID();
                await queuePrompt(workflow, promptId, clientId);
                
                const images = await waitForCompletion(ws, promptId);
                ws.close();
                
                if (images && images.length > 0) {
                    let imageUrl = images[0];
                    if (!imageUrl.startsWith('data:')) {
                        imageUrl = await convertImageToDataURL(imageUrl);
                    }
                    resolve(imageUrl);
                } else {
                    reject(new Error('未生成图片'));
                }
            } catch (error) {
                ws.close();
                reject(error);
            }
        };
        
        ws.onerror = (error) => {
            reject(new Error('WebSocket连接失败'));
        };
        
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                reject(new Error('生成超时'));
            }
        }, 120000);
    });
}

async function convertImageToDataURL(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[WriterMode] 转换图片失败:', error);
        return url;
    }
}
// 提交工作流到ComfyUI
async function queuePrompt(prompt, promptId, clientId) {
    const url = `http://${writerConfig.comfyuiUrl}/prompt`;
    const data = {
        prompt: prompt,
        client_id: clientId,
        prompt_id: promptId
    };
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    
    if (!response.ok) {
        throw new Error(`ComfyUI API错误: ${response.status}`);
    }
}

// 等待ComfyUI完成
async function waitForCompletion(ws, promptId) {
    return new Promise((resolve, reject) => {
        ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                
                if (message.type === 'executing' && 
                    message.data.node === null && 
                    message.data.prompt_id === promptId) {
                    
                    const history = await getHistory(promptId);
                    const images = await extractImagesFromHistory(history, promptId);
                    resolve(images);
                }
            } catch (error) {
                reject(error);
            }
        };
    });
}

// 获取历史记录
async function getHistory(promptId) {
    const url = `http://${writerConfig.comfyuiUrl}/history/${promptId}`;
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error('获取历史记录失败');
    }
    
    return await response.json();
}

// 从历史记录中提取图片
async function extractImagesFromHistory(history, promptId) {
    const images = [];
    
    if (history[promptId] && history[promptId].outputs) {
        for (const nodeId in history[promptId].outputs) {
            const nodeOutput = history[promptId].outputs[nodeId];
            if (nodeOutput.images) {
                for (const image of nodeOutput.images) {
                    const imageUrl = await getImageUrl(image.filename, image.subfolder, image.type);
                    images.push(imageUrl);
                }
            }
        }
    }
    
    return images;
}

// 获取图片URL
async function getImageUrl(filename, subfolder, type) {
    const params = new URLSearchParams({
        filename: filename,
        subfolder: subfolder || '',
        type: type || 'output'
    });
    
    const url = `http://${writerConfig.comfyuiUrl}/view?${params}`;
    
    const response = await fetch(url);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// 生成UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 打开配置模态框
function openConfigModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.85);
        z-index: 1000002;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: #0a0e1a;
        border: 1px solid rgba(0,255,255,0.5);
        border-radius: 20px;
        padding: 30px;
        width: 620px;
        max-height: 85vh;
        overflow-y: auto;
        color: #ccf;
        box-shadow: 0 20px 60px rgba(0,0,0,0.8);
    `;
    
    dialog.innerHTML = `
        <h2 style="color: #0ff; margin-bottom: 20px;">⚙ 作家模式配置</h2>
        
        <!-- ====== API 类型选择 ====== -->
        <div style="margin-bottom: 20px; background: rgba(0,255,255,0.05); padding: 15px; border-radius: 12px; border: 1px solid rgba(0,255,255,0.1);">
            <h3 style="color: #0ff; margin: 0 0 12px 0; font-size: 14px;">🤖 API 配置</h3>
            <label style="display: block; margin: 8px 0;">
                <input type="radio" name="api-type" value="local" ${writerConfig.apiType === 'local' ? 'checked' : ''}>
                <span style="color: #0ff;">本地 (KoboldCPP)</span>
                <span style="color: #666; font-size: 11px; margin-left: 8px;">- 本地运行，无需API密钥</span>
            </label>
            <label style="display: block; margin: 8px 0;">
                <input type="radio" name="api-type" value="remote" ${writerConfig.apiType === 'remote' ? 'checked' : ''}>
                <span style="color: #0ff;">远程 API</span>
                <span style="color: #666; font-size: 11px; margin-left: 8px;">- OpenAI / Claude / DeepSeek 等</span>
            </label>
        </div>
        
        <!-- ====== 本地 API 配置 ====== -->
        <div id="local-api-config" style="margin-bottom: 20px; ${writerConfig.apiType === 'local' ? '' : 'display: none;'}">
            <h3 style="color: #0ff; font-size: 13px;">🏠 KoboldCPP 设置</h3>
            <label style="display: block; margin: 10px 0;">
                服务器地址:
                <input type="text" id="config-kobold-url" value="${writerConfig.koboldcppUrl}" 
                       style="width: 100%; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; margin-top: 5px; box-sizing: border-box;">
            </label>
            <button id="test-kobold-btn" type="button" style="${createButtonStyle('#0ff', 'rgba(0,255,255,0.2)')}">🔌 测试连接</button>
            <span id="test-kobold-status" style="margin-left: 10px; font-size: 12px;"></span>
        </div>
        
        <!-- ====== 远程 API 配置 ====== -->
        <div id="remote-api-config" style="margin-bottom: 20px; ${writerConfig.apiType === 'remote' ? '' : 'display: none;'}">
            <h3 style="color: #0ff; font-size: 13px;">🌐 远程 API 设置</h3>
            
            <label style="display: block; margin: 10px 0;">
                提供商:
                <select id="config-api-provider" style="width: 100%; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; margin-top: 5px;">
                    <option value="openai" ${writerConfig.remoteProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
                    <option value="claude" ${writerConfig.remoteProvider === 'claude' ? 'selected' : ''}>Claude (Anthropic)</option>
                    <option value="deepseek" ${writerConfig.remoteProvider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                    <option value="custom" ${writerConfig.remoteProvider === 'custom' ? 'selected' : ''}>自定义 (OpenAI兼容)</option>
                </select>
            </label>
            
            <label style="display: block; margin: 10px 0;">
                API URL:
                <input type="text" id="config-remote-url" value="${writerConfig.remoteApiUrl}" 
                       placeholder="https://api.openai.com/v1/chat/completions"
                       style="width: 100%; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; margin-top: 5px; box-sizing: border-box;">
            </label>
            
            <label style="display: block; margin: 10px 0;">
                API Key:
                <div style="display: flex; gap: 8px; margin-top: 5px;">
                    <input type="password" id="config-api-key" value="${writerConfig.apiKey}" 
                           placeholder="sk-..."
                           style="flex: 1; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; box-sizing: border-box;">
                    <button id="toggle-key-visibility" type="button" style="${createButtonStyle('#0ff', 'rgba(0,255,255,0.1)')}">👁</button>
                </div>
                <div style="font-size: 11px; color: #666; margin-top: 4px;">API密钥将保存在本地浏览器中</div>
            </label>
            
            <label style="display: block; margin: 10px 0;">
                模型名称:
                <input type="text" id="config-remote-model" value="${writerConfig.remoteModel}" 
                       placeholder="gpt-3.5-turbo, claude-3-sonnet-20240229, deepseek-chat..."
                       style="width: 100%; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; margin-top: 5px; box-sizing: border-box;">
            </label>
            
            <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
                <button id="test-remote-btn" type="button" style="${createButtonStyle('#0ff', 'rgba(0,255,255,0.2)')}">🔌 测试连接</button>
                <button id="test-remote-generate-btn" type="button" style="${createButtonStyle('#0f0', 'rgba(0,255,0,0.15)')}">🧪 测试生成</button>
                <span id="test-remote-status" style="font-size: 12px; align-self: center;"></span>
            </div>
        </div>
        
        <!-- ====== ComfyUI 配置 ====== -->
        <div style="margin-bottom: 20px; padding: 16px; background: rgba(0, 255, 255, 0.05); border-radius: 12px; border: 1px solid rgba(0, 255, 255, 0.1);">
            <h3 style="color: #0ff; font-size: 13px; margin: 0 0 12px 0;">🎨 ComfyUI 配置</h3>
            
            <label style="display: block; margin: 10px 0;">
                ComfyUI 地址:
                <input type="text" id="config-comfyui-url" value="${writerConfig.comfyuiUrl}" 
                       placeholder="127.0.0.1:8188"
                       style="width: 100%; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; margin-top: 5px; box-sizing: border-box;">
            </label>
            <button id="test-comfyui-btn" type="button" style="${createButtonStyle('#0ff', 'rgba(0,255,255,0.2)')}">🔌 测试连接</button>
            <span id="test-comfyui-status" style="margin-left: 10px; font-size: 12px;"></span>
            
            <!-- ====== 工作流配置 ====== -->
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(0, 255, 255, 0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <span style="color: #888; font-size: 12px;">当前工作流:</span>
                        <span style="color: #0ff; font-family: monospace; margin-left: 8px;">${workflowManager.currentWorkflow?.name || '默认 (内置)'}</span>
                    </div>
                    <div>
                        <span style="color: #888; font-size: 11px; margin-right: 12px;">提示词节点: ${workflowManager.currentWorkflow?.promptNode || '11'}</span>
                        <button id="open-workflow-editor" type="button" style="${createButtonStyle('#0ff', 'rgba(0,255,255,0.15)')}">
                            🛠 高级编辑
                        </button>
                    </div>
                </div>
                <div style="color: #666; font-size: 11px; margin-top: 8px;">
                    💡 将工作流JSON文件放入 <strong style="color: #888;">scripts/extensions/third-party/WriterMode/json/</strong> 文件夹即可自动加载
                </div>
            </div>
        </div>
        
        <!-- ====== 连环画模式配置 ====== -->
        <div style="margin-bottom: 20px; border-top: 1px solid rgba(0,255,255,0.1); padding-top: 20px;">
            <h3 style="color: #0ff; font-size: 13px;">📖 连环画模式</h3>
            <label style="display: block; margin: 8px 0;">
                <input type="checkbox" id="config-storyboard" ${writerConfig.storyboardMode ? 'checked' : ''}>
                启用连环画模式
            </label>
            <label style="display: block; margin: 8px 0;">
                <input type="checkbox" id="config-auto-bind" ${writerConfig.autoBind ? 'checked' : ''}>
                自动绑定图片到文本
            </label>
            <label style="display: block; margin: 8px 0;">
                <input type="checkbox" id="config-auto-generate" ${writerConfig.autoGenerate ? 'checked' : ''}>
                自动生成图片
            </label>
            <label style="display: block; margin: 8px 0;">
                <input type="checkbox" id="config-local-images" ${writerConfig.localImagesEnabled ? 'checked' : ''}>
                启用本地图片加载
            </label>
            <label style="display: block; margin: 8px 0;">
                每多少字生成一张图片:
                <input type="number" id="config-generate-interval" value="${writerConfig.generateInterval}" min="100" max="2000" step="100"
                       style="width: 120px; padding: 5px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px;">
                <span style="color: #666; font-size: 11px; margin-left: 8px;">字</span>
            </label>
        </div>
    `;
    
    // 按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 20px;
        padding-top: 15px;
        border-top: 1px solid rgba(0,255,255,0.1);
    `;
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 保存配置';
    saveBtn.type = 'button';
    saveBtn.style.cssText = createButtonStyle('#0f0', 'rgba(0,255,0,0.2)');
    saveBtn.onclick = () => {
        saveConfigFromModal();
        modal.remove();
        applyConfig();
        showToast('✅ 配置已保存');
    };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = createButtonStyle('#f00', 'rgba(255,0,0,0.2)');
    cancelBtn.onclick = () => modal.remove();
    
    buttonContainer.appendChild(saveBtn);
    buttonContainer.appendChild(cancelBtn);
    dialog.appendChild(buttonContainer);
    
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    // ====== 绑定事件 ======
    bindConfigEvents(modal);
    
    // 工作流编辑器按钮
    const workflowEditorBtn = document.getElementById('open-workflow-editor');
    if (workflowEditorBtn) {
        workflowEditorBtn.onclick = () => {
            modal.remove();
            openWorkflowEditor();
        };
    }
    
    // ComfyUI 测试
    const testComfyBtn = document.getElementById('test-comfyui-btn');
    if (testComfyBtn) {
        testComfyBtn.onclick = async function() {
            const urlInput = document.getElementById('config-comfyui-url');
            const statusSpan = document.getElementById('test-comfyui-status');
            if (!urlInput) return;
            
            statusSpan.textContent = '⏳ 测试中...';
            statusSpan.style.color = '#ff0';
            
            try {
                const response = await fetch(`http://${urlInput.value}/system_stats`);
                if (response.ok) {
                    statusSpan.textContent = '✅ 连接成功！';
                    statusSpan.style.color = '#0f0';
                } else {
                    statusSpan.textContent = `❌ 连接失败 (${response.status})`;
                    statusSpan.style.color = '#f00';
                }
            } catch (e) {
                statusSpan.textContent = `❌ 连接失败: ${e.message}`;
                statusSpan.style.color = '#f00';
            }
        };
    }
}

// 绑定配置事件
function bindConfigEvents(modal) {
    // API 类型切换
    const apiRadios = modal.querySelectorAll('input[name="api-type"]');
    apiRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const localConfig = modal.querySelector('#local-api-config');
            const remoteConfig = modal.querySelector('#remote-api-config');
            if (this.value === 'local') {
                localConfig.style.display = '';
                remoteConfig.style.display = 'none';
            } else {
                localConfig.style.display = 'none';
                remoteConfig.style.display = '';
            }
        });
    });
    
    // 提供商切换
    const providerSelect = modal.querySelector('#config-api-provider');
    if (providerSelect) {
        providerSelect.addEventListener('change', function() {
            const provider = API_PROVIDERS[this.value];
            if (provider) {
                const urlInput = modal.querySelector('#config-remote-url');
                const modelInput = modal.querySelector('#config-remote-model');
                if (urlInput && provider.defaultUrl) {
                    urlInput.value = provider.defaultUrl;
                }
                if (modelInput && provider.defaultModel) {
                    modelInput.value = provider.defaultModel;
                }
                // 显示提示
                const statusSpan = modal.querySelector('#test-remote-status');
                if (statusSpan) {
                    statusSpan.textContent = `已选择 ${provider.name}`;
                    statusSpan.style.color = '#0f0';
                }
            }
        });
    }
    
    // 切换密钥可见性
    const toggleBtn = modal.querySelector('#toggle-key-visibility');
    const keyInput = modal.querySelector('#config-api-key');
    if (toggleBtn && keyInput) {
        toggleBtn.addEventListener('click', function() {
            keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
        });
    }
    
    // 测试 KoboldCPP
    const testKoboldBtn = modal.querySelector('#test-kobold-btn');
    if (testKoboldBtn) {
        testKoboldBtn.addEventListener('click', async function() {
            const urlInput = modal.querySelector('#config-kobold-url');
            const statusSpan = modal.querySelector('#test-kobold-status');
            if (!urlInput) return;
            
            statusSpan.textContent = '⏳ 测试中...';
            statusSpan.style.color = '#ff0';
            
            try {
                const response = await fetch(`${urlInput.value}/api/v1/model`);
                if (response.ok) {
                    statusSpan.textContent = '✅ 连接成功！';
                    statusSpan.style.color = '#0f0';
                } else {
                    statusSpan.textContent = `❌ 连接失败 (${response.status})`;
                    statusSpan.style.color = '#f00';
                }
            } catch (e) {
                statusSpan.textContent = `❌ 连接失败: ${e.message}`;
                statusSpan.style.color = '#f00';
            }
        });
    }
    
    // 测试远程连接
    const testRemoteBtn = modal.querySelector('#test-remote-btn');
    if (testRemoteBtn) {
        testRemoteBtn.addEventListener('click', testRemoteConnection);
    }
    
    // 测试远程生成
    const testGenerateBtn = modal.querySelector('#test-remote-generate-btn');
    if (testGenerateBtn) {
        testGenerateBtn.addEventListener('click', testRemoteGeneration);
    }
}

// 测试远程连接
async function testRemoteConnection() {
    const statusSpan = document.querySelector('#test-remote-status');
    if (!statusSpan) return;
    
    const url = document.querySelector('#config-remote-url')?.value;
    const key = document.querySelector('#config-api-key')?.value;
    const provider = document.querySelector('#config-api-provider')?.value;
    const model = document.querySelector('#config-remote-model')?.value;
    
    if (!url) {
        statusSpan.textContent = '❌ 请输入API URL';
        statusSpan.style.color = '#f00';
        return;
    }
    
    statusSpan.textContent = '⏳ 测试中...';
    statusSpan.style.color = '#ff0';
    
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // 根据不同提供商设置不同的认证头
        if (provider === 'claude') {
            headers['x-api-key'] = key;
            headers['anthropic-version'] = '2023-06-01';
        } else if (key) {
            headers['Authorization'] = `Bearer ${key}`;
        }
        
        // 构建测试请求
        let testBody;
        if (provider === 'claude') {
            testBody = {
                model: model || 'claude-3-sonnet-20240229',
                max_tokens: 1,
                messages: [
                    { role: 'user', content: 'Hello' }
                ]
            };
        } else {
            testBody = {
                model: model || 'gpt-3.5-turbo',
                max_tokens: 1,
                messages: [
                    { role: 'user', content: 'Hello' }
                ]
            };
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(testBody)
        });
        
        if (response.ok) {
            statusSpan.textContent = '✅ 连接成功！';
            statusSpan.style.color = '#0f0';
        } else {
            const errorText = await response.text();
            statusSpan.textContent = `❌ 连接失败 (${response.status})`;
            statusSpan.style.color = '#f00';
            console.error('[WriterMode] 远程连接测试失败:', errorText);
        }
    } catch (e) {
        statusSpan.textContent = `❌ 连接失败: ${e.message}`;
        statusSpan.style.color = '#f00';
    }
}

// 测试远程生成
async function testRemoteGeneration() {
    const statusSpan = document.querySelector('#test-remote-status');
    if (!statusSpan) return;
    
    const url = document.querySelector('#config-remote-url')?.value;
    const key = document.querySelector('#config-api-key')?.value;
    const provider = document.querySelector('#config-api-provider')?.value;
    const model = document.querySelector('#config-remote-model')?.value;
    
    if (!url) {
        statusSpan.textContent = '❌ 请输入API URL';
        statusSpan.style.color = '#f00';
        return;
    }
    
    statusSpan.textContent = '⏳ 测试生成...';
    statusSpan.style.color = '#ff0';
    
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (provider === 'claude') {
            headers['x-api-key'] = key;
            headers['anthropic-version'] = '2023-06-01';
        } else if (key) {
            headers['Authorization'] = `Bearer ${key}`;
        }
        
        let testBody;
        if (provider === 'claude') {
            testBody = {
                model: model || 'claude-3-sonnet-20240229',
                max_tokens: 50,
                messages: [
                    { role: 'user', content: 'Please respond with exactly: "Test successful"' }
                ]
            };
        } else {
            testBody = {
                model: model || 'gpt-3.5-turbo',
                max_tokens: 50,
                messages: [
                    { role: 'user', content: 'Please respond with exactly: "Test successful"' }
                ]
            };
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(testBody)
        });
        
        if (response.ok) {
            const data = await response.json();
            let content = '';
            if (provider === 'claude') {
                content = data.content?.[0]?.text || '';
            } else {
                content = data.choices?.[0]?.message?.content || '';
            }
            statusSpan.textContent = `✅ 生成成功: "${content.substring(0, 30)}..."`;
            statusSpan.style.color = '#0f0';
        } else {
            const errorText = await response.text();
            statusSpan.textContent = `❌ 生成失败 (${response.status})`;
            statusSpan.style.color = '#f00';
            console.error('[WriterMode] 远程生成测试失败:', errorText);
        }
    } catch (e) {
        statusSpan.textContent = `❌ 生成失败: ${e.message}`;
        statusSpan.style.color = '#f00';
    }
}

// 从模态框保存配置
function saveConfigFromModal() {
    const apiTypeRadio = document.querySelector('input[name="api-type"]:checked');
    writerConfig.apiType = apiTypeRadio ? apiTypeRadio.value : 'local';
    
    // 本地配置
    const koboldUrl = document.querySelector('#config-kobold-url');
    if (koboldUrl) writerConfig.koboldcppUrl = koboldUrl.value;
    
    // 远程配置
    const remoteUrl = document.querySelector('#config-remote-url');
    const apiKey = document.querySelector('#config-api-key');
    const remoteModel = document.querySelector('#config-remote-model');
    const provider = document.querySelector('#config-api-provider');
    
    if (remoteUrl) writerConfig.remoteApiUrl = remoteUrl.value;
    if (apiKey) writerConfig.apiKey = apiKey.value;
    if (remoteModel) writerConfig.remoteModel = remoteModel.value;
    if (provider) writerConfig.remoteProvider = provider.value;
    
    // 通用配置
    const storyboardCheck = document.querySelector('#config-storyboard');
    const autoBindCheck = document.querySelector('#config-auto-bind');
    const autoGenerateCheck = document.querySelector('#config-auto-generate');
    const localImagesCheck = document.querySelector('#config-local-images');
    const intervalInput = document.querySelector('#config-generate-interval');
    
    if (storyboardCheck) writerConfig.storyboardMode = storyboardCheck.checked;
    if (autoBindCheck) writerConfig.autoBind = autoBindCheck.checked;
    if (autoGenerateCheck) writerConfig.autoGenerate = autoGenerateCheck.checked;
    if (localImagesCheck) writerConfig.localImagesEnabled = localImagesCheck.checked;
    if (intervalInput) writerConfig.generateInterval = parseInt(intervalInput.value) || 500;
    
    saveConfig();
}

// 从模态框保存配置
// function saveConfigFromModal() {
//     writerConfig.koboldcppUrl = document.getElementById('config-kobold-url').value;
//     writerConfig.comfyuiUrl = document.getElementById('config-comfyui-url').value;
//     writerConfig.storyboardMode = document.getElementById('config-storyboard').checked;
//     writerConfig.autoBind = document.getElementById('config-auto-bind').checked;
//     writerConfig.autoGenerate = document.getElementById('config-auto-generate').checked;
//     writerConfig.localImagesEnabled = document.getElementById('config-local-images').checked;
//     writerConfig.generateInterval = parseInt(document.getElementById('config-generate-interval').value);
    
//     saveConfig();
// }

// 应用配置
function applyConfig() {
    if (overlay) {
        closeWriterMode();
        openWriterMode();
    }
}

// 测试KoboldCPP连接
async function testKoboldConnection() {
    const url = document.getElementById('config-kobold-url').value;
    try {
        const response = await fetch(`${url}/api/v1/model`);
        if (response.ok) {
            showToast('KoboldCPP连接成功！');
        } else {
            showToast('KoboldCPP连接失败');
        }
    } catch (e) {
        showToast('KoboldCPP连接失败: ' + e.message);
    }
}

// 测试ComfyUI连接
async function testComfyUIConnection() {
    const url = document.getElementById('config-comfyui-url').value;
    try {
        const response = await fetch(`http://${url}/system_stats`);
        if (response.ok) {
            showToast('ComfyUI连接成功！');
        } else {
            showToast('ComfyUI连接失败');
        }
    } catch (e) {
        showToast('ComfyUI连接失败: ' + e.message);
    }
}

// 打开历史模态框
async function openHistoryModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.85);
        z-index: 1000002;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: #0a0e1a;
        border: 1px solid rgba(0,255,255,0.5);
        border-radius: 20px;
        padding: 30px;
        width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        color: #ccf;
        box-shadow: 0 20px 60px rgba(0,0,0,0.8);
    `;
    
    // 头部
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        border-bottom: 1px solid rgba(0,255,255,0.1);
        padding-bottom: 15px;
    `;
    header.innerHTML = `
        <h2 style="color: #0ff; margin: 0;">📚 我的故事</h2>
        <button id="history-new-story" style="${createButtonStyle('#0f0', 'rgba(0,255,0,0.15)')}">
            ➕ 新建故事
        </button>
    `;
    dialog.appendChild(header);
    
    // 故事列表容器
    const listContainer = document.createElement('div');
    listContainer.id = 'history-list-container';
    listContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 15px;
        max-height: 50vh;
        overflow-y: auto;
    `;
    dialog.appendChild(listContainer);
    
    // 底部按钮
    const footer = document.createElement('div');
    footer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding-top: 15px;
        border-top: 1px solid rgba(0,255,255,0.1);
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.type = 'button';
    closeBtn.style.cssText = createButtonStyle('#0ff', 'rgba(0,255,255,0.2)');
    closeBtn.onclick = () => modal.remove();
    footer.appendChild(closeBtn);
    dialog.appendChild(footer);
    
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    // 渲染故事列表
    await renderHistoryList(listContainer);
    
    // 新建故事
    document.getElementById('history-new-story').onclick = async () => {
        const name = prompt('请输入新故事名称：');
        if (name && name.trim()) {
            const storyId = name.trim();
            // 检查是否已存在
            const existing = await getStoryIds();
            if (existing.includes(storyId)) {
                showToast('❌ 故事名称已存在');
                return;
            }
            // 创建新故事
            storyMode.currentStoryId = storyId;
            localStorage.setItem('writer-mode-current-story', storyId);
            storyMode.images = [];
            storyMode.imageBindings = [];
            storyMode.characterDescriptions = [];
            textarea.value = '';
            await saveContent();
            await saveStoryData();
            await saveCharacterDescriptions();
            
            // 更新标题显示
            const titleInput = document.getElementById('writer-story-title');
            if (titleInput) titleInput.value = storyId;
            
            showToast(`✅ 已创建故事: ${storyId}`);
            await renderHistoryList(listContainer);
        }
    };
}
async function getStoryIds() {
    const storyIds = new Set();
    
    // 从 localStorage 获取
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('writer-bindings-')) {
            storyIds.add(key.replace('writer-bindings-', ''));
        }
        if (key && key.startsWith('writer-characters-')) {
            storyIds.add(key.replace('writer-characters-', ''));
        }
    }
    
    // 从 IndexedDB 获取
    try {
        if (imageStorage.db) {
            const transaction = imageStorage.db.transaction(['stories'], 'readonly');
            const store = transaction.objectStore('stories');
            const allRecords = await new Promise((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            for (const record of allRecords) {
                if (record.id && !record.id.startsWith('bindings_')) {
                    storyIds.add(record.id);
                }
            }
        }
    } catch (e) {
        console.warn('[WriterMode] 获取IndexedDB故事失败:', e);
    }
    
    // 从 images 存储中获取
    try {
        if (imageStorage.db) {
            const transaction = imageStorage.db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const index = store.index('storyId');
            const allRecords = await new Promise((resolve, reject) => {
                const request = index.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            for (const record of allRecords) {
                if (record.storyId) {
                    storyIds.add(record.storyId);
                }
            }
        }
    } catch (e) {
        console.warn('[WriterMode] 获取IndexedDB图片故事失败:', e);
    }
    
    return Array.from(storyIds);
}

// 渲染历史列表
async function renderHistoryList(container) {
    if (!container) return;
    container.innerHTML = '';
    
    const storyIds = await getStoryIds();
    
    if (storyIds.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; color: rgba(255,255,255,0.3); padding: 40px 0;">
                <div style="font-size: 48px; margin-bottom: 12px;">📖</div>
                <div>暂无故事</div>
                <div style="font-size: 12px; margin-top: 6px; color: rgba(255,255,255,0.15);">点击「新建故事」开始创作</div>
            </div>
        `;
        return;
    }
    
    // 获取每个故事的详细信息
    const storyInfos = [];
    for (const id of storyIds) {
        try {
            const images = await imageStorage.getImages(id);
            const content = await imageStorage.getStoryContent(id);
            const charData = localStorage.getItem(`writer-characters-${id}`);
            const characters = charData ? JSON.parse(charData) : [];
            
            storyInfos.push({
                id: id,
                imageCount: images.length,
                contentLength: content ? content.length : 0,
                characterCount: characters.length,
                isCurrent: id === storyMode.currentStoryId,
                lastUpdated: images.length > 0 ? 
                    Math.max(...images.map(img => img.timestamp || 0)) : 
                    (content ? Date.now() : 0)
            });
        } catch (e) {
            storyInfos.push({
                id: id,
                imageCount: 0,
                contentLength: 0,
                characterCount: 0,
                isCurrent: id === storyMode.currentStoryId,
                lastUpdated: 0
            });
        }
    }
    
    // 按最后更新时间排序
    storyInfos.sort((a, b) => b.lastUpdated - a.lastUpdated);
    
    storyInfos.forEach(info => {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 12px 16px;
            background: ${info.isCurrent ? 'rgba(0,255,255,0.08)' : 'rgba(0,0,0,0.3)'};
            border: 1px solid ${info.isCurrent ? 'rgba(0,255,255,0.3)' : 'rgba(255,255,255,0.05)'};
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        item.onmouseenter = () => {
            item.style.background = 'rgba(255,255,255,0.05)';
            item.style.borderColor = 'rgba(0,255,255,0.2)';
        };
        item.onmouseleave = () => {
            item.style.background = info.isCurrent ? 'rgba(0,255,255,0.08)' : 'rgba(0,0,0,0.3)';
            item.style.borderColor = info.isCurrent ? 'rgba(0,255,255,0.3)' : 'rgba(255,255,255,0.05)';
        };
        
        // 左侧信息
        const leftInfo = document.createElement('div');
        leftInfo.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            min-width: 0;
        `;
        
        const nameRow = document.createElement('div');
        nameRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        nameRow.innerHTML = `
            <span style="color: ${info.isCurrent ? '#0ff' : '#ccf'}; font-weight: ${info.isCurrent ? 'bold' : 'normal'};">
                ${info.isCurrent ? '▶ ' : ''}${info.id}
            </span>
            ${info.isCurrent ? '<span style="font-size: 10px; color: #0ff;">当前</span>' : ''}
        `;
        leftInfo.appendChild(nameRow);
        
        const statsRow = document.createElement('div');
        statsRow.style.cssText = `
            display: flex;
            gap: 12px;
            font-size: 11px;
            color: #666;
        `;
        statsRow.innerHTML = `
            <span>🖼️ ${info.imageCount}张</span>
            <span>📝 ${info.contentLength}字</span>
            <span>👤 ${info.characterCount}个角色</span>
            ${info.lastUpdated > 0 ? `<span>🕐 ${new Date(info.lastUpdated).toLocaleDateString()}</span>` : ''}
        `;
        leftInfo.appendChild(statsRow);
        
        // 右侧操作按钮
        const actions = document.createElement('div');
        actions.style.cssText = `
            display: flex;
            gap: 4px;
            flex-shrink: 0;
        `;
        
        // 加载按钮
        const loadBtn = document.createElement('button');
        loadBtn.innerHTML = '📂';
        loadBtn.title = '加载故事';
        loadBtn.type = 'button';
        loadBtn.style.cssText = `
            background: none;
            border: none;
            color: ${info.isCurrent ? '#0ff' : '#888'};
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
            transition: all 0.2s;
            pointer-events: auto;
        `;
        loadBtn.onmouseenter = () => {
            loadBtn.style.background = 'rgba(0,255,255,0.15)';
            loadBtn.style.color = '#0ff';
        };
        loadBtn.onmouseleave = () => {
            loadBtn.style.background = 'none';
            loadBtn.style.color = info.isCurrent ? '#0ff' : '#888';
        };
        loadBtn.onclick = async (e) => {
            e.stopPropagation();
            if (info.isCurrent) {
                showToast('已经是当前故事');
                return;
            }
            await loadStory(info.id);
            // 更新标题显示
            const titleInput = document.getElementById('writer-story-title');
            if (titleInput) titleInput.value = info.id;
            await renderHistoryList(container);
            showToast(`✅ 已切换到: ${info.id}`);
        };
        actions.appendChild(loadBtn);
        
        // 重命名按钮
        const renameBtn = document.createElement('button');
        renameBtn.innerHTML = '✏️';
        renameBtn.title = '重命名';
        renameBtn.type = 'button';
        renameBtn.style.cssText = `
            background: none;
            border: none;
            color: #888;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
            transition: all 0.2s;
            pointer-events: auto;
        `;
        renameBtn.onmouseenter = () => {
            renameBtn.style.background = 'rgba(255,255,0,0.15)';
            renameBtn.style.color = '#ff0';
        };
        renameBtn.onmouseleave = () => {
            renameBtn.style.background = 'none';
            renameBtn.style.color = '#888';
        };
        renameBtn.onclick = async (e) => {
            e.stopPropagation();
            const newName = prompt(`重命名 "${info.id}" 为：`, info.id);
            if (newName && newName.trim() && newName.trim() !== info.id) {
                const newId = newName.trim();
                // 检查是否已存在
                const existing = await getStoryIds();
                if (existing.includes(newId)) {
                    showToast('❌ 故事名称已存在');
                    return;
                }
                await renameStory(info.id, newId);
                // 如果是当前故事，更新标题
                if (info.isCurrent) {
                    storyMode.currentStoryId = newId;
                    localStorage.setItem('writer-mode-current-story', newId);
                    const titleInput = document.getElementById('writer-story-title');
                    if (titleInput) titleInput.value = newId;
                }
                await renderHistoryList(container);
                showToast(`✅ 已重命名为: ${newId}`);
            }
        };
        actions.appendChild(renameBtn);
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = '删除故事';
        deleteBtn.type = 'button';
        deleteBtn.style.cssText = `
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
            transition: all 0.2s;
            pointer-events: auto;
        `;
        deleteBtn.onmouseenter = () => {
            deleteBtn.style.background = 'rgba(255,0,0,0.15)';
            deleteBtn.style.color = '#f66';
        };
        deleteBtn.onmouseleave = () => {
            deleteBtn.style.background = 'none';
            deleteBtn.style.color = '#666';
        };
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            const confirmMsg = info.isCurrent ? 
                `确定要删除当前故事 "${info.id}" 吗？\n⚠️ 此操作不可恢复！` :
                `确定要删除故事 "${info.id}" 吗？\n⚠️ 此操作不可恢复！`;
            if (confirm(confirmMsg)) {
                await deleteStory(info.id);
                // 如果删除的是当前故事，创建或切换到默认
                if (info.isCurrent) {
                    const remaining = await getStoryIds();
                    if (remaining.length > 0) {
                        await loadStory(remaining[0]);
                        const titleInput = document.getElementById('writer-story-title');
                        if (titleInput) titleInput.value = remaining[0];
                    } else {
                        // 创建默认故事
                        const defaultName = '默认故事';
                        storyMode.currentStoryId = defaultName;
                        localStorage.setItem('writer-mode-current-story', defaultName);
                        storyMode.images = [];
                        storyMode.imageBindings = [];
                        storyMode.characterDescriptions = [];
                        if (textarea) textarea.value = '';
                        await saveContent();
                        await saveStoryData();
                        await saveCharacterDescriptions();
                        const titleInput = document.getElementById('writer-story-title');
                        if (titleInput) titleInput.value = defaultName;
                        showToast('已创建默认故事');
                    }
                }
                await renderHistoryList(container);
                showToast(`🗑️ 已删除: ${info.id}`);
            }
        };
        actions.appendChild(deleteBtn);
        
        item.appendChild(leftInfo);
        item.appendChild(actions);
        container.appendChild(item);
    });
}

// 重命名故事
async function renameStory(oldId, newId) {
    try {
        // 1. 获取所有数据
        const images = await imageStorage.getImages(oldId);
        const content = await imageStorage.getStoryContent(oldId);
        const bindings = await imageStorage.loadBindings(oldId);
        const charData = localStorage.getItem(`writer-characters-${oldId}`);
        
        // 2. 保存到新ID
        for (const img of images) {
            await imageStorage.saveImage(newId, {
                url: img.imageUrl || img.url,
                prompt: img.prompt,
                timestamp: img.timestamp || Date.now(),
                isLocal: img.isLocal || false,
                localPath: img.localPath || ''
            });
        }
        
        if (content) {
            await imageStorage.saveStoryContent(newId, content);
        }
        
        if (bindings.length > 0) {
            await imageStorage.saveBindings(newId, bindings);
        }
        
        if (charData) {
            localStorage.setItem(`writer-characters-${newId}`, charData);
        }
        
        // 3. 删除旧数据
        for (const img of images) {
            if (img.id) {
                await imageStorage.deleteImage(img.id);
            }
        }
        
        // 删除旧的故事内容
        if (imageStorage.db) {
            const transaction = imageStorage.db.transaction(['stories'], 'readwrite');
            const store = transaction.objectStore('stories');
            await new Promise((resolve, reject) => {
                const request = store.delete(oldId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            // 删除旧的绑定记录
            const bindingId = `bindings_${oldId}`;
            await new Promise((resolve, reject) => {
                const request = store.delete(bindingId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
        
        // 删除 localStorage 中的旧数据
        localStorage.removeItem(`writer-bindings-${oldId}`);
        localStorage.removeItem(`writer-characters-${oldId}`);
        
        console.log('[WriterMode] 故事重命名成功:', oldId, '->', newId);
    } catch (e) {
        console.error('[WriterMode] 重命名失败:', e);
        throw e;
    }
}

// 删除故事
async function deleteStory(storyId) {
    try {
        // 1. 删除所有图片
        const images = await imageStorage.getImages(storyId);
        for (const img of images) {
            if (img.id) {
                await imageStorage.deleteImage(img.id);
            }
        }
        
        // 2. 删除故事内容
        if (imageStorage.db) {
            const transaction = imageStorage.db.transaction(['stories'], 'readwrite');
            const store = transaction.objectStore('stories');
            await new Promise((resolve, reject) => {
                const request = store.delete(storyId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            // 删除绑定记录
            const bindingId = `bindings_${storyId}`;
            await new Promise((resolve, reject) => {
                const request = store.delete(bindingId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
        
        // 3. 删除 localStorage 数据
        localStorage.removeItem(`writer-bindings-${storyId}`);
        localStorage.removeItem(`writer-characters-${storyId}`);
        
        // 4. 如果是当前故事，清除状态
        if (storyMode.currentStoryId === storyId) {
            storyMode.currentStoryId = null;
            localStorage.removeItem('writer-mode-current-story');
            storyMode.images = [];
            storyMode.imageBindings = [];
            storyMode.characterDescriptions = [];
            if (textarea) textarea.value = '';
        }
        
        console.log('[WriterMode] 故事删除成功:', storyId);
    } catch (e) {
        console.error('[WriterMode] 删除故事失败:', e);
        throw e;
    }
}

// 加载故事
// 修改 loadStory 函数
async function loadStory(storyId) {
    storyMode.currentStoryId = storyId;
    localStorage.setItem('writer-mode-current-story', storyId);
    await loadStoryData();
    
    // ====== 添加：恢复内容 ======
    await restoreContent();
    
    await refreshLocalImages();
    
    // 更新显示
    if (storyMode.images.length > 0) {
        const image = storyMode.images[storyMode.currentImageIndex] || storyMode.images[0];
        if (image) {
            displayImage(image.url);
        }
    }
    updateImageList();
    
    showToast(`已加载故事: ${storyId}`);
}

// 恢复内容
// 确保 restoreContent 函数正确设置 textarea 的值
async function restoreContent() {
    if (!storyMode.currentStoryId) {
        console.log('[WriterMode] 没有当前故事ID，跳过内容恢复');
        return;
    }
    
    if (!textarea) {
        console.log('[WriterMode] textarea 不存在，跳过内容恢复');
        return;
    }
    
    try {
        const content = await imageStorage.getStoryContent(storyMode.currentStoryId);
        if (content) {
            textarea.value = content;
            console.log('[WriterMode] 内容恢复成功，长度:', content.length);
        } else {
            // 如果没有内容，清空文本区域
            textarea.value = '';
            console.log('[WriterMode] 故事内容为空');
        }
        // 滚动到顶部
        textarea.scrollTop = 0;
    } catch (e) {
        console.error('[WriterMode] 内容恢复失败:', e);
        textarea.value = '';
    }
}

// 保存内容
async function saveContent() {
    if (!storyMode.currentStoryId || !textarea) return;
    
    try {
        await imageStorage.saveStoryContent(storyMode.currentStoryId, textarea.value);
    } catch (e) {
        console.error('[WriterMode] 内容保存失败:', e);
    }
}

// ============================================================
// 上下文模板管理
// ============================================================

// 模板配置
const TEMPLATE_PRESETS = {
    chatml: {
        name: 'ChatML 模板',
        icon: '💬',
        template: `<|im_start|>system

<|im_end|>
<|im_start|>user

<|im_end|>
<|im_start|>assistant

<|im_end|>`,
        cursorPositions: {
            system: '<|im_start|>system\n',
            user: '<|im_start|>user\n',
            assistant: '<|im_start|>assistant\n'
        }
    },
    think: {
        name: '思考标签',
        icon: '🤔',
        template: `<think>

</think>`,
        cursorPosition: '<think>\n'
    },
    chatml_think: {
        name: 'ChatML + 思考',
        icon: '🧠',
        template: `<|im_start|>system

<|im_end|>
<|im_start|>user

<|im_end|>
<|im_start|>assistant
<think>

</think>
<|im_end|>`,
        cursorPositions: {
            system: '<|im_start|>system\n',
            user: '<|im_start|>user\n',
            assistant: '<|im_start|>assistant\n<think>\n'
        }
    },
    system_only: {
        name: '系统提示 (System)',
        icon: '⚙️',
        template: `<|im_start|>system

<|im_end|>`,
        cursorPosition: '<|im_start|>system\n'
    },
    user_only: {
        name: '用户提示 (User)',
        icon: '👤',
        template: `<|im_start|>user

<|im_end|>`,
        cursorPosition: '<|im_start|>user\n'
    }
};

// 自定义模板存储
let customTemplates = [];

// 加载自定义模板
function loadCustomTemplates() {
    try {
        const saved = localStorage.getItem('writer-mode-custom-templates');
        if (saved) {
            customTemplates = JSON.parse(saved);
        }
    } catch (e) {
        console.error('[WriterMode] 加载自定义模板失败:', e);
        customTemplates = [];
    }
}

// 保存自定义模板
function saveCustomTemplates() {
    try {
        localStorage.setItem('writer-mode-custom-templates', JSON.stringify(customTemplates));
    } catch (e) {
        console.error('[WriterMode] 保存自定义模板失败:', e);
    }
}

// 获取所有模板（预设 + 自定义）
function getAllTemplates() {
    const presets = Object.entries(TEMPLATE_PRESETS).map(([id, config]) => ({
        id: `preset_${id}`,
        ...config,
        isPreset: true
    }));
    const customs = customTemplates.map((t, i) => ({
        ...t,
        id: `custom_${i}`,
        isPreset: false
    }));
    return [...presets, ...customs];
}

// 添加模板按钮到导航栏
function addTemplateButtonToHeader(header) {
    // 查找左侧区域
    const leftDiv = header.querySelector('div:first-child');
    if (!leftDiv) return;

    const templateBtn = document.createElement('button');
    templateBtn.id = 'writer-template-btn';
    templateBtn.innerHTML = '📋 上下文模板';
    templateBtn.style.cssText = `
        background: rgba(0,255,255,0.1);
        border: 1px solid rgba(0,255,255,0.3);
        color: #0ff;
        border-radius: 20px;
        padding: 6px 16px;
        cursor: pointer;
        font-family: monospace;
        font-size: 13px;
        transition: all 0.2s;
        pointer-events: auto;
        margin-left: 10px;
    `;
    templateBtn.onmouseenter = () => {
        templateBtn.style.background = 'rgba(0,255,255,0.2)';
        templateBtn.style.transform = 'scale(1.05)';
    };
    templateBtn.onmouseleave = () => {
        templateBtn.style.background = 'rgba(0,255,255,0.1)';
        templateBtn.style.transform = 'scale(1)';
    };
    templateBtn.onclick = (e) => {
        e.stopPropagation();
        toggleTemplateDropdown(templateBtn);
    };

    leftDiv.appendChild(templateBtn);
}

// 切换模板下拉菜单
function toggleTemplateDropdown(anchor) {
    const existing = document.getElementById('writer-template-dropdown');
    if (existing) {
        existing.remove();
        return;
    }

    const dropdown = document.createElement('div');
    dropdown.id = 'writer-template-dropdown';
    dropdown.style.cssText = `
        position: fixed;
        background: rgba(10, 15, 25, 0.95);
        border: 1px solid rgba(0, 255, 255, 0.4);
        border-radius: 12px;
        padding: 12px;
        z-index: 1000003;
        backdrop-filter: blur(20px);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
        min-width: 280px;
        max-height: 60vh;
        overflow-y: auto;
        pointer-events: auto;
    `;

    // 定位
    const rect = anchor.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 8) + 'px';
    dropdown.style.left = (rect.left - 20) + 'px';

    // 头部
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(0, 255, 255, 0.15);
        margin-bottom: 10px;
    `;
    header.innerHTML = `
        <span style="color: #0ff; font-size: 14px; font-weight: bold;">📋 上下文模板</span>
        <button id="template-manage-btn" style="
            background: none;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 14px;
            pointer-events: auto;
        " title="管理自定义模板">⚙️</button>
    `;
    dropdown.appendChild(header);

    // 模板列表
    const list = document.createElement('div');
    list.id = 'template-list';
    list.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
    `;

    const templates = getAllTemplates();
    templates.forEach(template => {
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            pointer-events: auto;
            border: 1px solid transparent;
        `;
        item.onmouseenter = () => {
            item.style.background = 'rgba(0, 255, 255, 0.08)';
            item.style.borderColor = 'rgba(0, 255, 255, 0.2)';
        };
        item.onmouseleave = () => {
            item.style.background = 'rgba(255, 255, 255, 0.03)';
            item.style.borderColor = 'transparent';
        };

        // 模板信息
        const info = document.createElement('span');
        info.style.cssText = `
            color: #ccf;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        info.innerHTML = `
            <span style="font-size: 16px;">${template.icon || '📄'}</span>
            <span>${template.name}</span>
            ${template.isPreset ? '<span style="font-size: 10px; color: #666;">预设</span>' : ''}
        `;

        // 操作按钮
        const actions = document.createElement('div');
        actions.style.cssText = `
            display: flex;
            gap: 4px;
        `;

        // 插入按钮
        const insertBtn = document.createElement('button');
        insertBtn.innerHTML = '📥';
        insertBtn.title = '插入模板';
        insertBtn.style.cssText = `
            background: none;
            border: none;
            color: #0ff;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 14px;
            pointer-events: auto;
            transition: all 0.2s;
        `;
        insertBtn.onmouseenter = () => {
            insertBtn.style.background = 'rgba(0, 255, 255, 0.15)';
        };
        insertBtn.onmouseleave = () => {
            insertBtn.style.background = 'none';
        };
        insertBtn.onclick = (e) => {
            e.stopPropagation();
            insertTemplate(template);
            dropdown.remove();
        };

        actions.appendChild(insertBtn);

        // 非预设模板显示删除按钮
        if (!template.isPreset) {
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = '删除模板';
            deleteBtn.style.cssText = `
                background: none;
                border: none;
                color: #f66;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 14px;
                pointer-events: auto;
                transition: all 0.2s;
            `;
            deleteBtn.onmouseenter = () => {
                deleteBtn.style.background = 'rgba(255, 0, 0, 0.15)';
            };
            deleteBtn.onmouseleave = () => {
                deleteBtn.style.background = 'none';
            };
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`确定要删除模板 "${template.name}" 吗？`)) {
                    const index = customTemplates.findIndex(t => t.name === template.name && t.template === template.template);
                    if (index !== -1) {
                        customTemplates.splice(index, 1);
                        saveCustomTemplates();
                        dropdown.remove();
                        toggleTemplateDropdown(anchor);
                    }
                }
            };
            actions.appendChild(deleteBtn);
        }

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
    });

    dropdown.appendChild(list);

    // 底部 - 添加自定义模板
    const footer = document.createElement('div');
    footer.style.cssText = `
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(0, 255, 255, 0.1);
        display: flex;
        gap: 8px;
    `;

    const addCustomBtn = document.createElement('button');
    addCustomBtn.innerHTML = '➕ 自定义模板';
    addCustomBtn.style.cssText = `
        flex: 1;
        padding: 8px 12px;
        background: rgba(0, 255, 255, 0.08);
        border: 1px dashed rgba(0, 255, 255, 0.3);
        color: #0ff;
        border-radius: 8px;
        cursor: pointer;
        font-family: monospace;
        font-size: 12px;
        pointer-events: auto;
        transition: all 0.2s;
    `;
    addCustomBtn.onmouseenter = () => {
        addCustomBtn.style.background = 'rgba(0, 255, 255, 0.15)';
    };
    addCustomBtn.onmouseleave = () => {
        addCustomBtn.style.background = 'rgba(0, 255, 255, 0.08)';
    };
    addCustomBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        openCustomTemplateEditor(anchor);
    };

    footer.appendChild(addCustomBtn);
    dropdown.appendChild(footer);

    document.body.appendChild(dropdown);

    // 点击外部关闭
    setTimeout(() => {
        document.addEventListener('click', closeDropdownOutside, { once: true });
    }, 10);
}

// 关闭下拉菜单
function closeDropdownOutside(e) {
    const dropdown = document.getElementById('writer-template-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        const btn = document.getElementById('writer-template-btn');
        if (btn && !btn.contains(e.target)) {
            dropdown.remove();
        }
    }
}

// 插入模板到文本区域
function insertTemplate(template) {
    if (!textarea) return;

    const text = textarea.value;
    const cursorPos = textarea.selectionStart;

    // 如果有选择文本，将选择文本作为模板内容的一部分
    const selectedText = text.substring(textarea.selectionStart, textarea.selectionEnd);

    // 构建最终插入内容
    let insertContent = template.template;

    // 如果有选中文本，替换模板中的占位符
    if (selectedText) {
        // 简单替换：查找模板中第一个空行或占位位置
        const lines = insertContent.split('\n');
        let inserted = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '' && !inserted) {
                // 在第一个空行插入选中文本
                lines[i] = selectedText;
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            // 如果没有空行，在末尾添加
            lines.push(selectedText);
        }
        insertContent = lines.join('\n');
    }

    // 插入文本
    const newText = text.substring(0, cursorPos) + insertContent + text.substring(cursorPos);
    textarea.value = newText;

    // 设置光标位置到模板中的合适位置
    let newCursorPos = cursorPos + insertContent.length;

    // 如果是ChatML模板，尝试定位到合适的位置
    if (template.id && template.id.includes('chatml')) {
        // 查找用户输入位置
        const userMarker = '<|im_start|>user\n';
        const userIndex = insertContent.indexOf(userMarker);
        if (userIndex !== -1) {
            newCursorPos = cursorPos + userIndex + userMarker.length;
        }
    } else if (template.id && template.id.includes('think')) {
        // 思考标签定位到 <think> 后面
        const thinkMarker = '<think>\n';
        const thinkIndex = insertContent.indexOf(thinkMarker);
        if (thinkIndex !== -1) {
            newCursorPos = cursorPos + thinkIndex + thinkMarker.length;
        }
    } else if (template.cursorPosition) {
        // 使用自定义光标位置
        const posIndex = insertContent.indexOf(template.cursorPosition);
        if (posIndex !== -1) {
            newCursorPos = cursorPos + posIndex + template.cursorPosition.length;
        }
    }

    // 如果模板有多个光标位置，使用第一个
    if (template.cursorPositions) {
        const positions = Object.values(template.cursorPositions);
        if (positions.length > 0) {
            const firstPos = positions[0];
            const posIndex = insertContent.indexOf(firstPos);
            if (posIndex !== -1) {
                newCursorPos = cursorPos + posIndex + firstPos.length;
            }
        }
    }

    textarea.setSelectionRange(newCursorPos, newCursorPos);
    textarea.focus();
    textarea.scrollTop = textarea.scrollHeight;

    showToast(`已插入模板: ${template.name}`);
}

// 打开自定义模板编辑器
function openCustomTemplateEditor(anchor) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 1000004;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: rgba(10, 15, 25, 0.98);
        border: 1px solid rgba(0, 255, 255, 0.5);
        border-radius: 16px;
        padding: 24px;
        width: 500px;
        max-width: 90vw;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
    `;

    dialog.innerHTML = `
        <h2 style="color: #0ff; margin-bottom: 16px;">📝 自定义模板</h2>
        
        <label style="display: block; margin-bottom: 12px;">
            <span style="color: #888; font-size: 12px; display: block; margin-bottom: 4px;">模板名称</span>
            <input type="text" id="custom-template-name" placeholder="例如: 我的模板" 
                   style="width: 100%; padding: 8px 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; box-sizing: border-box; font-family: monospace;">
        </label>
        
        <label style="display: block; margin-bottom: 12px;">
            <span style="color: #888; font-size: 12px; display: block; margin-bottom: 4px;">图标 (emoji)</span>
            <input type="text" id="custom-template-icon" placeholder="📄" value="📄" maxlength="2"
                   style="width: 60px; padding: 8px 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; font-size: 20px; text-align: center;">
        </label>
        
        <label style="display: block; margin-bottom: 12px;">
            <span style="color: #888; font-size: 12px; display: block; margin-bottom: 4px;">模板内容</span>
            <span style="color: #666; font-size: 11px; display: block; margin-bottom: 4px;">使用空行表示占位位置，选中文本将插入到第一个空行</span>
            <textarea id="custom-template-content" rows="8" 
                      placeholder="输入模板内容..."
                      style="width: 100%; padding: 8px 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,255,255,0.3); color: #ccf; border-radius: 8px; font-family: monospace; font-size: 13px; resize: vertical; box-sizing: border-box;"></textarea>
        </label>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button id="save-custom-template" type="button" style="${createButtonStyle('#0f0', 'rgba(0,255,0,0.2)')}">💾 保存模板</button>
            <button id="cancel-custom-template" type="button" style="${createButtonStyle('#f00', 'rgba(255,0,0,0.2)')}">取消</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 事件绑定
    dialog.querySelector('#save-custom-template').onclick = () => {
        const name = dialog.querySelector('#custom-template-name').value.trim();
        const icon = dialog.querySelector('#custom-template-icon').value.trim() || '📄';
        const template = dialog.querySelector('#custom-template-content').value;

        if (!name) {
            showToast('请输入模板名称');
            return;
        }
        if (!template) {
            showToast('请输入模板内容');
            return;
        }

        // 检查是否已存在同名模板
        if (customTemplates.some(t => t.name === name)) {
            if (!confirm(`模板 "${name}" 已存在，是否覆盖？`)) {
                return;
            }
            customTemplates = customTemplates.filter(t => t.name !== name);
        }

        customTemplates.push({
            name: name,
            icon: icon,
            template: template
        });

        saveCustomTemplates();
        overlay.remove();
        showToast(`已保存模板: ${name}`);
        
        // 重新打开下拉菜单
        if (anchor) {
            toggleTemplateDropdown(anchor);
        }
    };

    dialog.querySelector('#cancel-custom-template').onclick = () => {
        overlay.remove();
        if (anchor) {
            toggleTemplateDropdown(anchor);
        }
    };

    // 点击外部关闭
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.remove();
            if (anchor) {
                toggleTemplateDropdown(anchor);
            }
        }
    };
}

// 关闭作家模式
async function closeWriterMode() {
    if (isGenerating) {
        cancelGeneration();
    }
    
    await saveContent();
    await saveStoryData();
    await saveCharacterDescriptions();
    
    removeFloatingButtons();
    
    if (overlay) {
        overlay.remove();
        overlay = null;
        textarea = null;
    }
}

// 获取KoboldCPP配置
function getKoboldConfig() {
    const params = getGenerationParams();
    return {
        apiServer: writerConfig.koboldcppUrl,
        samplerParams: {
            max_context_length: params.maxContextLength,
            max_length: params.maxPredictTokens === -1 ? 1024 : params.maxPredictTokens,
            temperature: params.temperature,
            top_p: params.topP,
            top_k: params.topK,
            typical: 1,
            rep_pen: params.repeatPenalty,
            rep_pen_range: params.repPenRange,
            rep_pen_slope: 1,
            pres_pen: params.presPenalty,
            freq_pen: params.freqPenalty,
            min_p: params.minP,
            seed: params.seed === -1 ? Math.floor(Math.random() * 2147483647) : params.seed,
            sampler_order: [6, 0, 1, 3, 4, 2, 5],
            trim_stop: true,
            use_default_badwordsids: false,
            stream: true
        }
    };
}

// 发送消息 - 流式处理
async function onSendMessage() {
    if (isGenerating || !textarea) return;
    
    const originalContent = textarea.value.trim();
    if (!originalContent) {
        showToast('请在写作区域输入内容');
        return;
    }
    
    isGenerating = true;
    abortController = new AbortController();
    
    const sendBtn = document.getElementById('writer-send-btn');
    const cancelBtn = document.getElementById('writer-cancel-btn');
    const statusIndicator = document.getElementById('writer-status');
    
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = '◈ 流式创作中 ◈';
    }
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.style.opacity = '1';
    }
    if (statusIndicator) statusIndicator.style.display = 'flex';
    
    try {
        const contentStart = originalContent + '\n';
        textarea.value = contentStart;
        textarea.scrollTop = textarea.scrollHeight;
        
        // 根据API类型选择流式生成方式
        if (writerConfig.apiType === 'local') {
            await generateLocalStream(originalContent, contentStart);
        } else {
            await generateRemoteStream(originalContent, contentStart);
        }
        
        await saveContent();
        
    }  catch (error) {
        if (error.name === 'AbortError') {
            textarea.value += '\n\n[已取消生成]';
        } else {
            showToast('生成失败: ' + (error.message || '未知错误'));
        }
    } finally {
        finishGeneration();
    }
}

async function generateLocalStream(originalContent, contentStart) {
    const config = getKoboldConfig();
    const apiUrl = `${config.apiServer}/extra/generate/stream`;
    
    const requestBody = {
        prompt: originalContent,
        ...config.samplerParams
    };
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal
    });
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let generatedText = '';
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            
            if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if (data === '[DONE]') continue;
                
                try {
                    const parsed = JSON.parse(data);
                    const token = parsed.token || parsed.text || parsed.content || '';
                    if (token) {
                        generatedText += token;
                        textarea.value = contentStart + generatedText;
                        textarea.scrollTop = textarea.scrollHeight;
                        
                        if (writerConfig.autoGenerate && writerConfig.storyboardMode) {
                            checkAutoGenerate(textarea.value.length);
                        }
                        
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                } catch (e) {
                    if (data && data !== '[DONE]') {
                        generatedText += data;
                        textarea.value = contentStart + generatedText;
                        textarea.scrollTop = textarea.scrollHeight;
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                }
            }
        }
    }
}

async function generateRemoteStream(originalContent, contentStart) {
    const provider = writerConfig.remoteProvider;
    const url = writerConfig.remoteApiUrl;
    const key = writerConfig.apiKey;
    const model = writerConfig.remoteModel;
    
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (provider === 'claude') {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
    } else if (key) {
        headers['Authorization'] = `Bearer ${key}`;
    }
    
    // Claude 不支持流式，使用非流式
    if (provider === 'claude') {
        const body = {
            model: model || 'claude-3-sonnet-20240229',
            max_tokens: 2048,
            temperature: 0.7,
            messages: [
                { role: 'user', content: originalContent }
            ]
        };
        
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            signal: abortController.signal
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Claude API错误 (${response.status}): ${errorText}`);
        }
        
        const data = await response.json();
        const content = data.content?.[0]?.text || '';
        
        if (content) {
            textarea.value = contentStart + content;
            textarea.scrollTop = textarea.scrollHeight;
        }
        return;
    }
    
    // OpenAI 兼容流式
    const body = {
        model: model || 'gpt-3.5-turbo',
        max_tokens: 2048,
        temperature: 0.7,
        stream: true,
        messages: [
            { role: 'user', content: originalContent }
        ]
    };
    
    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: abortController.signal
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`远程API错误 (${response.status}): ${errorText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let generatedText = '';
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            
            if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        generatedText += delta;
                        textarea.value = contentStart + generatedText;
                        textarea.scrollTop = textarea.scrollHeight;
                        
                        if (writerConfig.autoGenerate && writerConfig.storyboardMode) {
                            checkAutoGenerate(textarea.value.length);
                        }
                        
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            }
        }
    }
}

// ============================================================
// 工作流管理器
// ============================================================

// 工作流状态
let workflowManager = {
    currentWorkflow: null,
    workflowName: '默认',
    promptNodeId: '11', // 默认提示词节点ID
    promptField: 'text', // 默认字段名
    workflows: [], // 可用工作流列表
    customWorkflows: [] // 自定义工作流
};

// 工作流加载路径
const WORKFLOW_PATH = 'scripts/extensions/third-party/WriterMode/json/';

// 加载工作流列表
async function loadWorkflowList() {
    try {
        // 尝试从json文件夹加载
        const response = await fetch(WORKFLOW_PATH);
        if (response.ok) {
            const html = await response.text();
            const fileMatches = html.match(/href="([^"]*\.json)"/gi);
            if (fileMatches) {
                const files = fileMatches.map(match => {
                    const hrefMatch = match.match(/href="([^"]*)"/i);
                    return hrefMatch ? decodeURIComponent(hrefMatch[1]) : '';
                }).filter(Boolean);
                
                for (const file of files) {
                    await loadWorkflowFromFile(file);
                }
            }
        }
    } catch (e) {
        console.log('[WriterMode] 无法加载工作流列表，使用默认工作流');
    }
    
    // 如果没有加载到任何工作流，使用默认
    if (workflowManager.workflows.length === 0) {
        workflowManager.workflows.push({
            name: '默认 (内置)',
            file: 'default',
            workflow: WORKFLOW_TEMPLATE,
            promptNode: '11',
            promptField: 'text'
        });
        workflowManager.currentWorkflow = workflowManager.workflows[0];
    }
}

// 从文件加载工作流
async function loadWorkflowFromFile(filename) {
    try {
        const response = await fetch(`${WORKFLOW_PATH}${filename}`);
        if (response.ok) {
            const workflow = await response.json();
            const name = filename.replace('.json', '');
            
            // 自动检测提示词节点
            const promptNode = detectPromptNode(workflow);
            
            workflowManager.workflows.push({
                name: name,
                file: filename,
                workflow: workflow,
                promptNode: promptNode.nodeId,
                promptField: promptNode.field
            });
            
            console.log('[WriterMode] 加载工作流:', name);
        }
    } catch (e) {
        console.error('[WriterMode] 加载工作流失败:', filename, e);
    }
}

// 自动检测提示词节点
function detectPromptNode(workflow) {
    // 检测包含文本输入的节点
    const candidates = [];
    
    for (const [nodeId, nodeData] of Object.entries(workflow)) {
        // 检查是否包含文本输入字段
        if (nodeData.inputs) {
            for (const [fieldName, fieldValue] of Object.entries(nodeData.inputs)) {
                if (typeof fieldValue === 'string' && 
                    (fieldName.toLowerCase().includes('text') || 
                     fieldName.toLowerCase().includes('prompt') ||
                     fieldName.toLowerCase().includes('positive'))) {
                    candidates.push({
                        nodeId: nodeId,
                        field: fieldName,
                        value: fieldValue,
                        classType: nodeData.class_type
                    });
                }
            }
        }
    }
    
    // 优先选择包含 "text" 或 "prompt" 的节点
    for (const candidate of candidates) {
        if (candidate.field === 'text' || candidate.field === 'prompt') {
            return { nodeId: candidate.nodeId, field: candidate.field };
        }
    }
    
    // 如果有候选节点，使用第一个
    if (candidates.length > 0) {
        return { nodeId: candidates[0].nodeId, field: candidates[0].field };
    }
    
    // 默认
    return { nodeId: '11', field: 'text' };
}

// ============================================================
// 工作流编辑器UI
// ============================================================

// 在工作流配置对话框中添加高级编辑功能
function openWorkflowEditor() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.85);
        z-index: 1000005;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: rgba(10, 15, 25, 0.98);
        border: 1px solid rgba(0, 255, 255, 0.5);
        border-radius: 16px;
        padding: 24px;
        width: 90vw;
        max-width: 1200px;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
    `;
    
    // 头部
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 1px solid rgba(0, 255, 255, 0.1);
    `;
    header.innerHTML = `
        <div>
            <h2 style="color: #0ff; margin: 0;">🎨 工作流编辑器</h2>
            <span style="color: #666; font-size: 12px;">选择工作流并配置提示词节点</span>
        </div>
        <button id="workflow-editor-close" style="
            background: none;
            border: none;
            color: #0ff;
            font-size: 24px;
            cursor: pointer;
            padding: 0 10px;
        ">✕</button>
    `;
    dialog.appendChild(header);
    
    // 主要内容 - 左右布局
    const content = document.createElement('div');
    content.style.cssText = `
        display: grid;
        grid-template-columns: 300px 1fr;
        gap: 20px;
        min-height: 400px;
    `;
    
    // 左侧 - 工作流列表和配置
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 16px;
    `;
    
    // 工作流选择
    const workflowSelect = document.createElement('div');
    workflowSelect.style.cssText = `
        background: rgba(0, 0, 0, 0.4);
        border-radius: 10px;
        padding: 16px;
    `;
    workflowSelect.innerHTML = `
        <label style="color: #888; font-size: 12px; display: block; margin-bottom: 8px;">📁 选择工作流</label>
        <select id="workflow-select" style="
            width: 100%;
            padding: 8px 12px;
            background: rgba(0,0,0,0.5);
            border: 1px solid rgba(0,255,255,0.3);
            color: #ccf;
            border-radius: 8px;
            font-family: monospace;
            font-size: 13px;
        ">
            ${workflowManager.workflows.map((wf, i) => `
                <option value="${i}" ${i === workflowManager.workflows.indexOf(workflowManager.currentWorkflow) ? 'selected' : ''}>
                    ${wf.name} ${wf.file === 'default' ? '(内置)' : ''}
                </option>
            `).join('')}
        </select>
    `;
    leftPanel.appendChild(workflowSelect);
    
    // 提示词节点配置
    const promptConfig = document.createElement('div');
    promptConfig.style.cssText = `
        background: rgba(0, 0, 0, 0.4);
        border-radius: 10px;
        padding: 16px;
        border: 1px solid rgba(0, 255, 255, 0.15);
    `;
    promptConfig.innerHTML = `
        <div style="color: #0ff; font-size: 13px; margin-bottom: 12px;">🎯 提示词节点配置</div>
        
        <label style="color: #888; font-size: 11px; display: block; margin-bottom: 4px;">节点 ID</label>
        <input id="prompt-node-id" type="text" value="${workflowManager.currentWorkflow?.promptNode || '11'}" 
               style="
                   width: 100%;
                   padding: 6px 10px;
                   background: rgba(0,0,0,0.5);
                   border: 1px solid rgba(0,255,255,0.3);
                   color: #0ff;
                   border-radius: 6px;
                   font-family: monospace;
                   font-size: 13px;
                   margin-bottom: 10px;
                   box-sizing: border-box;
               ">
        
        <label style="color: #888; font-size: 11px; display: block; margin-bottom: 4px;">字段名</label>
        <input id="prompt-field" type="text" value="${workflowManager.currentWorkflow?.promptField || 'text'}" 
               style="
                   width: 100%;
                   padding: 6px 10px;
                   background: rgba(0,0,0,0.5);
                   border: 1px solid rgba(0,255,255,0.3);
                   color: #0ff;
                   border-radius: 6px;
                   font-family: monospace;
                   font-size: 13px;
                   margin-bottom: 10px;
                   box-sizing: border-box;
               ">
        
        <div style="color: #666; font-size: 11px; margin-top: 8px;">
            💡 提示：在下方节点列表中点击节点可快速填充
        </div>
    `;
    leftPanel.appendChild(promptConfig);
    
    // 操作按钮
    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
    `;
    
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '🔄 刷新工作流列表';
    refreshBtn.style.cssText = createButtonStyle('#0ff', 'rgba(0,255,255,0.1)');
    refreshBtn.onclick = async () => {
        await loadWorkflowList();
        showToast('工作流列表已刷新');
        modal.remove();
        openWorkflowEditor();
    };
    actions.appendChild(refreshBtn);
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 保存配置';
    saveBtn.style.cssText = createButtonStyle('#0f0', 'rgba(0,255,255,0.15)');
    saveBtn.onclick = () => {
        const select = document.getElementById('workflow-select');
        const nodeId = document.getElementById('prompt-node-id').value.trim();
        const field = document.getElementById('prompt-field').value.trim();
        
        if (select) {
            const index = parseInt(select.value);
            if (index >= 0 && index < workflowManager.workflows.length) {
                workflowManager.currentWorkflow = workflowManager.workflows[index];
                workflowManager.currentWorkflow.promptNode = nodeId;
                workflowManager.currentWorkflow.promptField = field;
                
                // 保存到配置
                writerConfig.workflowConfig = {
                    promptNode: nodeId,
                    promptField: field,
                    workflowName: workflowManager.currentWorkflow.name
                };
                saveConfig();
                
                showToast('✅ 工作流配置已保存');
                modal.remove();
            }
        }
    };
    actions.appendChild(saveBtn);
    
    leftPanel.appendChild(actions);
    
    // 右侧 - 工作流预览
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = `
        background: rgba(0, 0, 0, 0.4);
        border-radius: 10px;
        padding: 16px;
        overflow: auto;
        max-height: 60vh;
    `;
    
    // 工作流节点列表
    const nodeList = document.createElement('div');
    nodeList.id = 'workflow-node-list';
    nodeList.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
    `;
    
    // 渲染节点
    function renderWorkflowNodes(workflow) {
        nodeList.innerHTML = '';
        
        if (!workflow) {
            nodeList.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">未选择工作流</div>';
            return;
        }
        
        const entries = Object.entries(workflow.workflow);
        const promptNodeId = workflow.promptNode || '11';
        
        // 节点标题
        const title = document.createElement('div');
        title.style.cssText = `
            color: #888;
            font-size: 11px;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            display: flex;
            justify-content: space-between;
        `;
        title.innerHTML = `
            <span>📋 节点列表 (${entries.length}个)</span>
            <span style="color: #0ff;">提示词节点: <strong>${promptNodeId}</strong></span>
        `;
        nodeList.appendChild(title);
        
        entries.forEach(([nodeId, nodeData]) => {
            const isPromptNode = nodeId === promptNodeId;
            const item = document.createElement('div');
            item.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 10px;
                background: ${isPromptNode ? 'rgba(0, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)'};
                border-radius: 6px;
                border: 1px solid ${isPromptNode ? 'rgba(0, 255, 255, 0.3)' : 'transparent'};
                cursor: pointer;
                transition: all 0.2s;
                font-family: monospace;
                font-size: 12px;
            `;
            
            item.onmouseenter = () => {
                item.style.background = 'rgba(255, 255, 255, 0.05)';
            };
            item.onmouseleave = () => {
                item.style.background = isPromptNode ? 'rgba(0, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)';
            };
            
            // 点击节点自动填充提示词配置
            item.onclick = () => {
                const nodeIdInput = document.getElementById('prompt-node-id');
                const fieldInput = document.getElementById('prompt-field');
                
                // 查找文本输入字段
                if (nodeData.inputs) {
                    for (const [fieldName, fieldValue] of Object.entries(nodeData.inputs)) {
                        if (typeof fieldValue === 'string' && 
                            (fieldName.toLowerCase().includes('text') || 
                             fieldName.toLowerCase().includes('prompt') ||
                             fieldName.toLowerCase().includes('positive') ||
                             fieldName.toLowerCase().includes('negative'))) {
                            fieldInput.value = fieldName;
                            break;
                        }
                    }
                }
                nodeIdInput.value = nodeId;
                
                // 高亮提示
                item.style.background = 'rgba(0, 255, 0, 0.15)';
                setTimeout(() => {
                    item.style.background = isPromptNode ? 'rgba(0, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)';
                }, 500);
                
                showToast(`已选择节点 ${nodeId}`);
            };
            
            // 节点信息
            const info = document.createElement('span');
            info.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
            `;
            
            // 节点ID和类型
            info.innerHTML = `
                <span style="color: ${isPromptNode ? '#0ff' : '#888'}; font-weight: ${isPromptNode ? 'bold' : 'normal'};">
                    ${nodeId}
                </span>
                <span style="color: #666; font-size: 10px;">${nodeData.class_type || 'unknown'}</span>
                ${isPromptNode ? '<span style="color: #0ff; font-size: 10px;">🎯</span>' : ''}
            `;
            
            // 显示输入字段
            const fields = document.createElement('span');
            fields.style.cssText = `
                color: #555;
                font-size: 10px;
                max-width: 200px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            
            if (nodeData.inputs) {
                const inputKeys = Object.keys(nodeData.inputs).filter(k => 
                    typeof nodeData.inputs[k] === 'string' && 
                    !k.startsWith('_') &&
                    nodeData.inputs[k].length > 0
                );
                if (inputKeys.length > 0) {
                    fields.textContent = `📝 ${inputKeys.slice(0, 3).join(', ')}${inputKeys.length > 3 ? '...' : ''}`;
                }
            }
            
            item.appendChild(info);
            item.appendChild(fields);
            nodeList.appendChild(item);
        });
        
        // 添加提示
        const tip = document.createElement('div');
        tip.style.cssText = `
            margin-top: 12px;
            padding: 10px;
            background: rgba(0, 255, 255, 0.05);
            border-radius: 6px;
            color: #666;
            font-size: 11px;
            text-align: center;
            border: 1px dashed rgba(0, 255, 255, 0.15);
        `;
        tip.textContent = '💡 点击任意节点可快速设置为提示词节点';
        nodeList.appendChild(tip);
    }
    
    // 初始渲染
    renderWorkflowNodes(workflowManager.currentWorkflow);
    rightPanel.appendChild(nodeList);
    
    content.appendChild(leftPanel);
    content.appendChild(rightPanel);
    dialog.appendChild(content);
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    // 事件绑定
    // 工作流选择切换
    const select = document.getElementById('workflow-select');
    if (select) {
        select.onchange = function() {
            const index = parseInt(this.value);
            const wf = workflowManager.workflows[index];
            if (wf) {
                renderWorkflowNodes(wf);
                document.getElementById('prompt-node-id').value = wf.promptNode || '11';
                document.getElementById('prompt-field').value = wf.promptField || 'text';
            }
        };
    }
    
    // 关闭
    document.getElementById('workflow-editor-close').onclick = () => {
        modal.remove();
    };
}
function addWorkflowConfigToModal(dialog) {
    // 在工作流配置区域添加
    const workflowSection = document.createElement('div');
    workflowSection.style.cssText = `
        margin-bottom: 20px;
        padding: 16px;
        background: rgba(0, 255, 255, 0.05);
        border-radius: 12px;
        border: 1px solid rgba(0, 255, 255, 0.1);
    `;
    workflowSection.innerHTML = `
        <h3 style="color: #0ff; font-size: 13px; margin: 0 0 12px 0;">🎨 工作流配置</h3>
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <span style="color: #888; font-size: 12px;">当前工作流:</span>
            <span style="color: #0ff; font-family: monospace;">${workflowManager.currentWorkflow?.name || '默认'}</span>
            <span style="color: #888; font-size: 11px;">提示词节点: ${workflowManager.currentWorkflow?.promptNode || '11'}</span>
            <button id="open-workflow-editor" type="button" style="${createButtonStyle('#0ff', 'rgba(0,255,255,0.15)')}">
                🛠 高级编辑
            </button>
        </div>
        <div style="color: #666; font-size: 11px; margin-top: 8px;">
            💡 将工作流JSON文件放入 <strong>json/</strong> 文件夹即可自动加载
        </div>
    `;
    
    // 找到合适的位置插入
    const storyboardSection = dialog.querySelector('#config-storyboard')?.closest('div');
    if (storyboardSection) {
        storyboardSection.parentNode.insertBefore(workflowSection, storyboardSection);
    }
}
// 检查是否需要自动生成图片 - 完整版
function checkAutoGenerate(currentLength) {
    if (!writerConfig.autoGenerate) return;
    if (!writerConfig.storyboardMode) return;
    
    const lastPosition = writerConfig.lastGeneratedPosition;
    if (currentLength - lastPosition >= writerConfig.generateInterval) {
        writerConfig.lastGeneratedPosition = currentLength;
        
        const textStart = Math.max(0, currentLength - writerConfig.generateInterval);
        const textEnd = currentLength;
        const textFragment = textarea.value.substring(textStart, textEnd);
        
        // 避免生成太短的片段
        if (textFragment.length < 20) return;
        
        setTimeout(async () => {
            try {
                // 自动生成时使用所有角色描述
                const allCharacters = storyMode.characterDescriptions || [];
                console.log('[WriterMode] 自动生成，使用角色:', allCharacters.map(c => c.name).join(', '));
                
                const prompt = await generatePromptFromText(textFragment, allCharacters);
                console.log('[WriterMode] 自动生成提示词:', prompt);
                
                const imageUrl = await generateImage(prompt);
                
                // 保存图片
                const imageRecord = await imageStorage.saveImage(storyMode.currentStoryId, {
                    url: imageUrl,
                    prompt: prompt,
                    timestamp: Date.now(),
                    isLocal: false
                });
                
                const binding = {
                    textRange: { start: textStart, end: textEnd },
                    startRatio: textStart / textarea.value.length,
                    endRatio: textEnd / textarea.value.length,
                    imageUrl: imageUrl,
                    imageId: imageRecord.id,
                    prompt: prompt,
                    timestamp: Date.now()
                };
                
                storyMode.imageBindings.push(binding);
                storyMode.images.push({
                    id: imageRecord.id,
                    url: imageUrl,
                    prompt: prompt,
                    timestamp: Date.now(),
                    isLocal: false
                });
                
                updateImageList();
                await saveStoryData();
                
                showToast('自动生成图片成功！');
            } catch (error) {
                console.error('[WriterMode] 自动生成图片失败:', error);
            }
        }, 1000);
    }
}

// 取消生成
function cancelGeneration() {
    if (isGenerating) {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        isGenerating = false;
        finishGeneration();
    }
}

// 完成生成
function finishGeneration() {
    isGenerating = false;
    abortController = null;
    
    const sendBtn = document.getElementById('writer-send-btn');
    const cancelBtn = document.getElementById('writer-cancel-btn');
    const statusIndicator = document.getElementById('writer-status');
    
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '✧ 发送消息 ✧';
    }
    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.style.opacity = '0.5';
    }
    if (statusIndicator) statusIndicator.style.display = 'none';
}

// 添加图片查看器样式
function addImageViewerStyles() {
    const styleId = 'writer-mode-viewer-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        #writer-image-viewer .active {
            background: rgba(0,255,255,0.15) !important;
            color: #0ff !important;
        }
        #writer-image-viewer .ctrl-row input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 12px; height: 12px;
            border-radius: 50%;
            background: #0ff;
            cursor: pointer;
        }
        #writer-image-viewer .ctrl-row input[type="range"]::-moz-range-thumb {
            width: 12px; height: 12px;
            border-radius: 50%;
            background: #0ff;
            cursor: pointer;
            border: none;
        }
        #writer-image-viewer .ctrl-row input[type="range"]:focus {
            outline: none;
        }
        #writer-image-viewer .ctrl-row input[type="range"] {
            height: 3px;
            -webkit-appearance: none;
            appearance: none;
            background: rgba(255,255,255,0.12);
            border-radius: 2px;
            outline: none;
        }
        #writer-image-viewer .ctrl-row input[type="range"]::-webkit-slider-runnable-track {
            height: 3px;
            background: rgba(255,255,255,0.12);
            border-radius: 2px;
        }
        #writer-image-viewer .ctrl-row input[type="range"]::-moz-range-track {
            height: 3px;
            background: rgba(255,255,255,0.12);
            border-radius: 2px;
            border: none;
        }
        #writer-image-viewer img {
            transition: none !important;
        }
        #writer-magnifier img {
            transition: none !important;
        }
        #writer-image-viewer:fullscreen {
            background: rgba(0,0,0,0.95);
        }
        #writer-image-viewer:fullscreen #writer-image-placeholder {
            color: rgba(255,255,255,0.2);
        }
        #writer-image-viewer:fullscreen #writer-current-image {
            max-width: 95%;
            max-height: 95%;
        }
        #writer-image-viewer button {
            pointer-events: auto;
        }
        #writer-float-controls button,
        #writer-float-controls input {
            pointer-events: auto;
        }
    `;
    document.head.appendChild(style);
}
// 保存原始的 openWriterMode 函数引用
const originalOpenWriterMode = openWriterMode;

// 重写 openWriterMode
openWriterMode = async function() {
    if (overlay) return;
    
    overlay = document.createElement('div');
    overlay.id = 'writer-mode-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle at 20% 30%, #0a0e1a, #03050a);
        z-index: 1000000;
        display: flex;
        flex-direction: column;
        font-family: 'Courier New', monospace;
    `;
    
    const grid = document.createElement('div');
    grid.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-image: 
            linear-gradient(rgba(0,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.05) 1px, transparent 1px);
        background-size: 30px 30px;
        pointer-events: none;
    `;
    overlay.appendChild(grid);
    
    const header = createHeader();
    overlay.appendChild(header);
    addTemplateButtonToHeader(header);
    
    const contentArea = document.createElement('div');
    contentArea.id = 'writer-content-area';
    contentArea.style.cssText = `
        flex: 1;
        display: flex;
        overflow: hidden;
        z-index: 10;
        position: relative;
    `;
    
    const writingArea = createWritingArea();
    contentArea.appendChild(writingArea);
    
    if (writerConfig.storyboardMode) {
        const imageArea = createImageArea();
        contentArea.appendChild(imageArea);
    }
    
    overlay.appendChild(contentArea);
    
    const statusIndicator = createStatusIndicator();
    overlay.appendChild(statusIndicator);
    
    document.body.appendChild(overlay);
    
    bindEvents();
    
    await restoreContent();
    await refreshLocalImages();
    
    initImageViewer();
    loadCharacterDescriptions();
    createFloatingButtons();
    
    // ====== 新增：创建参数按钮和字数统计 ======
    createParamButton();
    createWordCounter();
    startWordCounter();
    
    if (storyMode.images.length > 0) {
        const image = storyMode.images[storyMode.currentImageIndex] || storyMode.images[0];
        if (image) {
            displayImage(image.url);
        }
    }
    
    textarea.focus();
    
    // 首次更新字数
    setTimeout(updateWordCounter, 100);
};

const originalCloseWriterMode = closeWriterMode;

closeWriterMode = async function() {
    if (isGenerating) {
        cancelGeneration();
    }
    
    await saveContent();
    await saveStoryData();
    await saveCharacterDescriptions();
    
    removeFloatingButtons();
    stopWordCounter();
    
    // 移除参数按钮
    const paramBtn = document.getElementById('writer-param-btn');
    if (paramBtn) paramBtn.remove();
    
    // 移除字数统计
    const counter = document.getElementById('writer-word-counter');
    if (counter) counter.remove();
    
    // 移除任何残留的模态框
    const paramModal = document.getElementById('writer-param-modal');
    if (paramModal) paramModal.remove();
    
    if (overlay) {
        overlay.remove();
        overlay = null;
        textarea = null;
    }
};

const originalInit = init;

init = async function() {
    if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
        setTimeout(init, 200);
        return;
    }
    
    context = SillyTavern.getContext();
    console.log('[WriterMode] 初始化完成');
    
    // ====== 新增：加载参数配置 ======
    loadGenerationParams();
    
    loadConfig();
    loadCustomTemplates();
    await loadWorkflowList();
    await imageStorage.init();
    await loadStoryData();
    
    addImageViewerStyles();
    addWriterButton();
    
    // 添加全局参数按钮（在关闭Writer Mode时也可用）
    // 但只在Writer Mode打开时显示，所以通过openWriterMode创建
    console.log('[WriterMode] 作家模式扩展已加载，参数配置已就绪');
};

const originalGenerateLocalStream = generateLocalStream;

generateLocalStream = async function(originalContent, contentStart) {
    const config = getKoboldConfig();
    const apiUrl = `${config.apiServer}/extra/generate/stream`;
    
    const requestBody = {
        prompt: originalContent,
        ...config.samplerParams,
        // 确保使用配置中的参数
        temperature: config.samplerParams.temperature,
        top_p: config.samplerParams.top_p,
        top_k: config.samplerParams.top_k,
        rep_pen: config.samplerParams.rep_pen,
        rep_pen_range: config.samplerParams.rep_pen_range,
        min_p: config.samplerParams.min_p,
        seed: config.samplerParams.seed,
        max_length: config.samplerParams.max_length,
        max_context_length: config.samplerParams.max_context_length,
    };
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal
    });
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let generatedText = '';
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            
            if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if (data === '[DONE]') continue;
                
                try {
                    const parsed = JSON.parse(data);
                    const token = parsed.token || parsed.text || parsed.content || '';
                    if (token) {
                        generatedText += token;
                        textarea.value = contentStart + generatedText;
                        textarea.scrollTop = textarea.scrollHeight;
                        
                        // 更新字数统计
                        updateWordCounter();
                        
                        if (writerConfig.autoGenerate && writerConfig.storyboardMode) {
                            checkAutoGenerate(textarea.value.length);
                        }
                        
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                } catch (e) {
                    if (data && data !== '[DONE]') {
                        generatedText += data;
                        textarea.value = contentStart + generatedText;
                        textarea.scrollTop = textarea.scrollHeight;
                        updateWordCounter();
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                }
            }
        }
    }
};

// 修改 bindEvents 函数，添加文本变化监听
const originalBindEvents = bindEvents;

bindEvents = function() {
    originalBindEvents();
    
    if (textarea) {
        // 添加 input 事件监听，实时更新字数
        textarea.addEventListener('input', updateWordCounter);
    }
};

// 将参数配置暴露到全局
window.WriterMode = {
    generationParams: generationParams,
    getGenerationParams: getGenerationParams,
    saveGenerationParams: saveGenerationParams,
    loadGenerationParams: loadGenerationParams,
    openParamModal: openParamModal,
    updateWordCounter: updateWordCounter,
};
// 显示提示
function showToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.8);
        color: #0ff;
        padding: 8px 16px;
        border-radius: 20px;
        border: 1px solid #0ff;
        font-family: monospace;
        font-size: 14px;
        z-index: 10000000;
        white-space: nowrap;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

// 启动扩展
init();
// Node.js 服务器启动包装脚本
// 此脚本由 NodeJsSpiderService 自动生成

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

// ============== HTTP/HTTPS 请求拦截器 ==============

// 豆瓣 User-Agent（微信小程序格式，经验证可用）
const DOUBAN_USER_AGENT = 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36 MicroMessenger/7.0.9.501 NetType/WIFI MiniProgramEnv/Windows WindowsWechat';

// 从 server_config.json 读取服务器配置（用于重定向 localhost 请求）
let serverBaseUrl = null;
let serverAuth = null;
try {
    const serverConfigPath = path.resolve('D:/TVSpider/nodejs/dist', './server_config.json');
    if (fs.existsSync(serverConfigPath)) {
        const serverConfigContent = fs.readFileSync(serverConfigPath, 'utf8');
        const serverConfig = JSON.parse(serverConfigContent);
        if (serverConfig.url) {
            serverBaseUrl = serverConfig.url;
            serverAuth = serverConfig.authorization || null;
            console.log('[Redirect] 服务器地址已加载:', serverBaseUrl);
        }
    }
} catch (e) {
    console.warn('[Redirect] 加载服务器配置失败:', e.message);
}

// 检查是否需要重定向 localhost 请求到真实服务器
function shouldRedirectToServer(options) {
    const host = options.host || options.hostname || '';
    return serverBaseUrl && (host === 'localhost' || host === '127.0.0.1' || host === '' || !host);
}

// 重定向请求到真实服务器
function redirectToServer(options) {
    if (!serverBaseUrl) return options;
    
    try {
        const serverUrl = new URL(serverBaseUrl);
        const originalPath = options.path || '/';
        
        console.log('[Redirect] 重定向请求: localhost' + originalPath + ' -> ' + serverBaseUrl + originalPath);
        
        options.hostname = serverUrl.hostname;
        options.host = serverUrl.host;
        options.port = serverUrl.port || (serverUrl.protocol === 'https:' ? 443 : 80);
        
        options.headers = options.headers || {};
        options.headers['Host'] = serverUrl.host;
        
        if (serverAuth) {
            options.headers['Authorization'] = serverAuth;
        }
    } catch (e) {
        console.error('[Redirect] 重定向失败:', e.message);
    }
    
    return options;
}

// 保存原始方法
const originalHttpRequest = http.request;
const originalHttpGet = http.get;
const originalHttpsRequest = https.request;
const originalHttpsGet = https.get;

// 拦截 http.request
http.request = function(options, callback) {
    if (shouldRedirectToServer(options)) {
        options = redirectToServer(options);
        if (serverBaseUrl && serverBaseUrl.startsWith('https://')) {
            return originalHttpsRequest.apply(https, arguments);
        }
    }
    return originalHttpRequest.apply(this, arguments);
};

// 拦截 http.get
http.get = function(options, callback) {
    if (typeof options === 'string') {
        try { options = new URL(options); } catch(e) {}
    }
    if (shouldRedirectToServer(options)) {
        options = redirectToServer(options);
        if (serverBaseUrl && serverBaseUrl.startsWith('https://')) {
            return originalHttpsGet.apply(https, arguments);
        }
    }
    return originalHttpGet.apply(this, arguments);
};

// 检查是否是豆瓣 API 请求
function isDoubanApiRequest(options) {
    const host = options.host || options.hostname || '';
    return host.includes('douban.com');
}

// 修改豆瓣请求的 headers
function patchDoubanHeaders(options) {
    if (isDoubanApiRequest(options)) {
        options.headers = options.headers || {};
        options.headers['User-Agent'] = DOUBAN_USER_AGENT;
        options.headers['Referer'] = 'https://servicewechat.com/wx2f9b06c1de1ccfca/84/page-frame.html';
        console.log('[Douban] 已修改请求头:', options.path || options.pathname);
    }
}

// 拦截 https.request
https.request = function(options, callback) {
    if (typeof options === 'string') {
        try { options = new URL(options); } catch(e) {}
    }
    patchDoubanHeaders(options);
    return originalHttpsRequest.apply(this, arguments);
};

// 拦截 https.get
https.get = function(options, callback) {
    if (typeof options === 'string') {
        try { options = new URL(options); } catch(e) {}
    }
    patchDoubanHeaders(options);
    return originalHttpsGet.apply(this, arguments);
};

console.log('[Interceptor] HTTP/HTTPS 拦截器已安装');

// ============== 服务器工厂函数 ==============

// 定义 catServerFactory 全局函数（用于 Fastify 的自定义服务器工厂）
globalThis.catServerFactory = function(handle) {
    let port = 0;
    const server = http.createServer(function(req, res) {
        // 包装 handle 函数，添加错误处理以防止 ERR_HTTP_HEADERS_SENT 错误导致服务器崩溃
        try {
            // 监听响应错误事件
            res.on('error', function(err) {
                // 忽略 ERR_HTTP_HEADERS_SENT 错误（响应头已发送的错误）
                // 这通常发生在 Fastify 已经发送响应后，代码又尝试发送响应头的情况
                if (err.code === 'ERR_HTTP_HEADERS_SENT') {
                    // 静默忽略，不打印错误日志，避免日志污染
                    return;
                }
                // 其他错误仍然记录
                console.error('[Server] 响应错误:', err.message);
            });
            
            // 调用原始的 handle 函数
            handle(req, res);
        } catch (err) {
            // 捕获同步错误
            if (err.code === 'ERR_HTTP_HEADERS_SENT') {
                // 静默忽略
                return;
            }
            // 其他错误需要处理
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Internal Server Error');
            }
        }
    });
    
    // 监听服务器错误事件
    server.on('error', function(err) {
        // 忽略 ERR_HTTP_HEADERS_SENT 错误
        if (err.code === 'ERR_HTTP_HEADERS_SENT') {
            return;
        }
        console.error('[Server] 服务器错误:', err.message);
    });
    
    server.on('listening', function() {
        port = server.address().port;
        console.log('Run on ' + port);
        // 将端口写入文件（移动端通过文件检测端口）
        try {
            fs.writeFileSync(path.join('D:/TVSpider/nodejs/dist', 'server_port.txt'), port.toString(), 'utf8');
        } catch (e) {
            console.error('[Server] 写入端口文件失败:', e.message);
        }
    });
    
    server.on('close', function() {
        console.log('Close on ' + port);
    });
    
    return server;
};

// 定义 catDartServerPort 全局函数（用于与 Dart 通信）
globalThis.catDartServerPort = function() {
    return 0;
};

// 添加全局错误处理，防止未捕获的异常导致进程退出
// 特别是 ERR_HTTP_HEADERS_SENT 错误，这通常发生在响应已发送后尝试再次发送响应头
process.on('uncaughtException', function(err) {
    // 忽略 ERR_HTTP_HEADERS_SENT 错误（响应头已发送的错误）
    // 这通常发生在 Fastify 已经发送响应后，代码又尝试发送响应头的情况
    if (err.code === 'ERR_HTTP_HEADERS_SENT') {
        // 静默忽略，不打印错误日志，避免日志污染
        return;
    }
    // 其他未捕获的异常仍然记录，但不退出进程（让服务器继续运行）
    console.error('[UncaughtException] 未捕获的异常:', err.message);
    console.error('[UncaughtException] 错误堆栈:', err.stack);
});

process.on('unhandledRejection', function(reason, promise) {
    // 处理未处理的 Promise 拒绝
    if (reason && reason.code === 'ERR_HTTP_HEADERS_SENT') {
        // 静默忽略
        return;
    }
    console.error('[UnhandledRejection] 未处理的 Promise 拒绝:', reason);
});

// 加载 index.js（包含 start 函数）
const indexModule = require('D:/TVSpider/nodejs/dist/index.js');

// 加载配置（index.config.js）
// 注意：如果配置文件不存在，使用空配置（配置可能通过 /config 接口获取）
let config = {};
const configPath = 'D:/TVSpider/nodejs/dist/index.config.js';
if (fs.existsSync(configPath)) {
    try {
        const configModule = require(configPath);
        // CommonJS 模块可能导出 default 或直接导出对象
        config = configModule.default || configModule;
        console.log('已加载配置文件:', configPath);
    } catch (e) {
        console.warn('无法加载配置文件:', e.message);
        console.warn('配置文件路径:', configPath);
        // 如果配置文件加载失败，使用空配置
        config = {};
    }
} else {
    console.log('配置文件不存在，使用空配置:', configPath);
    console.log('配置将通过 /config 接口获取');
}

// 加载服务器配置到 config.server
try {
    const serverConfigPath2 = path.resolve('D:/TVSpider/nodejs/dist', './server_config.json');
    if (fs.existsSync(serverConfigPath2)) {
        const serverConfigContent2 = fs.readFileSync(serverConfigPath2, 'utf8');
        const serverConfig2 = JSON.parse(serverConfigContent2);
        if (serverConfig2.url) {
            config.server = serverConfig2;
            console.log('服务器配置已加载到 config.server:', serverConfig2.url);
        }
    }
} catch (e) {
    console.warn('加载服务器配置到 config 失败:', e.message);
}

// 调用 start 函数启动服务器
if (typeof indexModule.start === 'function') {
    // 确保 config 不为 undefined，至少是一个对象
    if (!config || typeof config !== 'object') {
        config = {};
    }
    
    // 如果配置对象没有 list 属性，添加一个空数组（某些服务器代码可能需要）
    if (!config.hasOwnProperty('list')) {
        config.list = [];
    }
    
    console.log('启动服务器，配置对象键:', Object.keys(config));
    
    indexModule.start(config).catch(function(err) {
        console.error('服务器启动失败:', err);
        console.error('错误堆栈:', err.stack);
        console.error('传入的配置对象:', JSON.stringify(config, null, 2));
        process.exit(1);
    });
} else {
    console.error('错误: index.js 中未找到 start 函数');
    console.error('index.js 路径: D:/TVSpider/nodejs/dist/index.js');
    console.error('indexModule 内容:', Object.keys(indexModule));
    process.exit(1);
}

// 保持进程运行
process.on('SIGTERM', function() {
    if (typeof indexModule.stop === 'function') {
        indexModule.stop().then(function() {
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

process.on('SIGINT', function() {
    if (typeof indexModule.stop === 'function') {
        indexModule.stop().then(function() {
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

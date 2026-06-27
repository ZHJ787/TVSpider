#!/usr/bin/env python
# -*- coding: utf-8 -*-
# @File     : build.py
# @Author   : jade / ZHJ787
# @Date     : 2024/4/22 10:53
# @Email    : jadehh@1ive.com
# @Software : Samples
# @Desc     : 一键构建 TVBox/CatOpen 配置 + Node.js dist 产物
#
# 用法（最简）：
#     python build.py
# 仅构建某个站源：
#     python build.py --key jable
# 携带凭据（按需）：
#     python build.py --aliToken xxx --biliCookie yyy --quarkCookie zzz --is_18 True
#
# 完整流程（一键完成）：
#     1. 扫描 js/ 目录里的所有爬虫
#     2. 生成 18_tv_config.json   （TVBox）
#     3. 生成 18_open_config.json （CatOpen）
#     4. 生成 nodejs/src/spider/{video,book,pan}/*.js + router.js + index.config.js
#     5. 自愈 esbuild.js（treeShaking+footer，避免 start 被消除）
#     6. 自愈 nodejs/src/index.js（globalThis.__catVodEntry 绑定）
#     7. 执行 npm run build 打包 dist/index.js + dist/index.config.js
#     8. 写入 dist/package.json（CommonJS 声明，让 Node 当 CJS 解析）
#     9. 自检 dist/index.js 是否真的导出 start/stop 函数
#    10. 输出构建摘要 + 客户端接入 URL

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime


# ====================================================================
# 内置工具函数（原本依赖私有库 jade，现在内置，零外部 Python 依赖）
# ====================================================================

def str_to_bool(s):
    """把字符串 'True'/'true'/'1'/'yes' 转 bool"""
    if isinstance(s, bool):
        return s
    if isinstance(s, (int, float)):
        return bool(s)
    if isinstance(s, str):
        return s.strip().lower() in ('true', '1', 'yes', 'y', 'on')
    return bool(s)


def CreateSavePath(path):
    """递归创建目录，已存在不报错"""
    os.makedirs(path, exist_ok=True)
    return path


def GetLastDir(path):
    """取路径最后一段，等价于 basename"""
    return os.path.basename(path.rstrip('/\\'))


def GetTimeStamp(fmt="%Y-%m-%d %H:%M:%S"):
    """返回当前时间戳字符串"""
    return datetime.now().strftime(fmt)


# ====================================================================
# 站源模块解析
# ====================================================================

class JSMoudle:
    """解析单个 js/ 爬虫脚本，提取 key/name/type 等元信息"""

    def __init__(self, js_file):
        self.js_file = js_file
        self.js_name = GetLastDir(js_file).split(".")[0]
        self.getContent()

    def getContent(self):
        with open(self.js_file, "rb") as f:
            self.js_str = str(f.read(), encoding="utf-8")

    def _extract_return_str(self, func_name):
        """通用：从 getName/getAppName/getJSName 形如 `getName() { ... return "xxx" }` 中取字符串"""
        try:
            after = self.js_str.split(func_name + "()", 1)[-1]
            # 取第一个 return "xxx"
            m = re.search(r'return\s+"([^"]+)"', after)
            if m:
                return m.group(1)
            m = re.search(r"return\s+'([^']+)'", after)
            if m:
                return m.group(1)
            return None
        except Exception:
            return None

    def getName(self):
        return self._extract_return_str("getName")

    def getAppName(self):
        return self._extract_return_str("getAppName")

    def getJSName(self):
        return self._extract_return_str("getJSName")

    def getType(self):
        try:
            after = self.js_str.split("getType()", 1)[-1]
            m = re.search(r'return\s+(\d+)', after)
            return int(m.group(1)) if m else None
        except Exception:
            return None


# ====================================================================
# 构建主类
# ====================================================================

class Build:
    def __init__(self, channelKey, aliToken, biliCookie, quarkCookie, version=None):
        # 项目根目录（build.py 所在目录）必须先设置，后续方法要用
        self.rootDir = os.path.dirname(os.path.abspath(__file__))
        self.nodejsDir = os.path.join(self.rootDir, "nodejs")
        self.distDir = os.path.join(self.nodejsDir, "dist")
        # 凭据按需取第一个
        self.aliToken = aliToken.split(",")[0] if aliToken else ""
        self.biliCookie = biliCookie.split(",")[0] if biliCookie else ""
        self.quarkCookie = quarkCookie.split(",")[0] if quarkCookie else ""
        # 版本号：默认时间戳 vYYYYMMDDHHMM，用户可指定
        if version:
            self.version = version
        else:
            self.version = "v" + datetime.now().strftime("%Y%m%d%H%M")
        self.jsMouleList = self.getJsFile(channelKey)

    # ---------- 扫描爬虫 ----------

    def getJsFile(self, channelKey):
        jsMoudleList = []
        js_path = os.path.join(self.rootDir, "js")
        if not os.path.isdir(js_path):
            print("[WARN] js 目录不存在: {}".format(js_path))
            return jsMoudleList
        # 跳过基类文件（Spider 父类）和自动生成的版本检测站点
        SKIP_FILES = {"spider.js", "_version.js"}
        SKIP_JS_NAMES = {"base"}
        for fileName in sorted(os.listdir(js_path)):
            if not fileName.endswith(".js"):
                continue
            if fileName in SKIP_FILES:
                continue
            full_path = os.path.join(js_path, fileName)
            if not os.path.isfile(full_path):
                continue
            jsMoudle = JSMoudle(full_path)
            if jsMoudle.getName() is None:
                continue
            if jsMoudle.getJSName() in SKIP_JS_NAMES:
                continue
            if channelKey:
                if channelKey == jsMoudle.getJSName():
                    jsMoudleList.append(jsMoudle)
            else:
                jsMoudleList.append(jsMoudle)
        return jsMoudleList

    # ---------- TVBox/CatOpen 配置 ----------

    def getBaseConfig(self, baseObj, jsMoudle, tvType="TVBox"):
        baseObj["key"] = jsMoudle.js_name
        baseObj["name"] = jsMoudle.getName()
        baseObj["ext"] = {"box": tvType}
        # 用相对路径 (相对配置文件所在目录), jsMoudle.js_file 可能是绝对路径或相对路径
        # 统一转成 ./js/xxx.js 格式
        rel = jsMoudle.js_file.replace("\\", "/")
        if "/js/" in rel:
            rel = "js/" + rel.split("/js/", 1)[1]
        elif rel.startswith("js/"):
            pass
        baseObj["api"] = "./" + rel
        baseObj["type"] = jsMoudle.getType()
        return baseObj

    def getCustomConfig(self, baseObj, jsMoudle):
        app = jsMoudle.getAppName() or ""
        if "阿里" in app or "厂长直连" in app:
            baseObj["ext"]["aliToken"] = self.aliToken
            baseObj["ext"]["quarkCookie"] = self.quarkCookie
        elif app == "哔哩哔哩":
            baseObj["ext"]["cookie"] = self.biliCookie
        return baseObj

    def getConfig(self, tyType="TVBox", type=3):
        baseObj = {"key": "", "name": "", "api": "", "timeout": 30, "ext": {}}
        if type == 3:
            baseObj["playerType"] = 0
        siteList = []
        for jsMoudle in self.jsMouleList:
            if jsMoudle.getType() == type:
                siteObj = baseObj.copy()
                # 浅拷贝 ext，避免共用引用
                siteObj["ext"] = dict(baseObj["ext"])
                siteObj = self.getBaseConfig(siteObj, jsMoudle, tyType)
                siteObj = self.getCustomConfig(siteObj, jsMoudle)
                siteList.append(siteObj)
        return siteList

    def getJsList(self, tyType="TVBox", type=3):
        jsList = []
        for jsMoudle in self.jsMouleList:
            if jsMoudle.getType() == type:
                jsList.append(jsMoudle)
        return jsList

    def getConfigByTvType(self, tvType):
        videoConfig = self.getConfig(tvType, 3)
        bookConfig = self.getConfig(tvType, 10)
        carToonConfig = self.getConfig(tvType, 20)
        jsonConfig = self.getJsonConfigByTvType(tvType)
        return videoConfig, bookConfig, carToonConfig, jsonConfig

    def getJsonConfigByTvType(self, tvType):
        jsonPath = os.path.join(self.rootDir, "json", "{}.json".format(tvType))
        with open(jsonPath, "rb") as f:
            return json.load(f)

    def writeJsonConfig(self, tvType, jsonConfig):
        config_name = "{}_config.json".format(tvType)
        out_path = os.path.join(self.rootDir, config_name)
        with open(out_path, "wb") as f:
            f.write(json.dumps(jsonConfig, indent=4, ensure_ascii=False).encode("utf-8"))
        print("    -> {}".format(out_path))

    def writeVersionJsForTVBox(self):
        """生成 TVBox QuickJS 兼容的 _version.js (放在 js/ 目录)
        TVBox 用 QuickJS 引擎, 不支持 Node.js 风格代码, 需要独立的极简实现
        只导出 __jsEvalReturn, 不依赖任何 import
        """
        v = self.version
        content = """// TVBox 版本检测站点 (自动生成, 请勿手动修改)
// name 含版本号, 用于确认 TVBox 加载了哪个版本的配置
var version = '__VERSION__';
function getName() { return '🔧版本-' + version; }
function getAppName() { return 'Version'; }
function getJSName() { return '_version'; }
function getType() { return 3; }
function init(cfg) {}
function home(filter) {
    return JSON.stringify({
        class: [{ type_name: '版本信息', type_id: 'info' }],
        list: [],
        filters: {}
    });
}
function homeVod() { return JSON.stringify({ list: [] }); }
function category(tid, pg, filter, extend) {
    return JSON.stringify({ page: 1, pagecount: 1, limit: 0, total: 0, list: [] });
}
function detail(id) { return JSON.stringify({ list: [] }); }
function play(flag, id, flags) { return JSON.stringify({}); }
function search(wd, quick) { return JSON.stringify({ list: [] }); }
function __jsEvalReturn() {
    return {
        init: init, home: home, homeVod: homeVod, category: category,
        detail: detail, play: play, search: search
    };
}
""".replace("__VERSION__", v)
        out_path = os.path.join(self.rootDir, "js", "_version.js")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("    -> {} (TVBox 版本: {})".format(out_path, v))

    def getVersionSiteForTVBox(self):
        """生成 TVBox 配置里的 _version 站点条目 (引用 js/_version.js)"""
        return {
            "key": "_version",
            "name": "🔧版本-{}".format(self.version),
            "api": "./js/_version.js",
            "timeout": 30,
            "ext": {"box": "TVBox"},
            "playerType": 0,
            "type": 3
        }

    def writeTVConfig(self):
        print("[1/4] Write TVBox Config")
        self.writeVersionJsForTVBox()
        tvType = "TVBox"
        videoConfig, bookConfig, carToonConfig, jsonConfig = self.getConfigByTvType(tvType)
        # 在站点列表最前面加 _version 测试站点
        videoConfig.insert(0, self.getVersionSiteForTVBox())
        jsonConfig["sites"] = videoConfig
        self.writeJsonConfig("tv", jsonConfig)

    def writeOpenConfig(self):
        print("[2/4] Write CatOpen Config")
        tvType = "CatOpen"
        videoConfig, bookConfig, carToonConfig, jsonConfig = self.getConfigByTvType(tvType)
        jsonConfig["video"]["sites"] = videoConfig
        jsonConfig["read"]["sites"] = bookConfig
        self.writeJsonConfig("open", jsonConfig)

    # ---------- Node.js spider 源码生成 ----------

    def jsToNodejs(self, jsList, typeName="video"):
        nodejsPath = os.path.join(self.nodejsDir, "src", "spider")
        savePath = CreateSavePath(os.path.join(nodejsPath, typeName))
        templatePath = os.path.join(nodejsPath, "tmpSpider.txt")
        for jsMoudle in jsList:
            with open(templatePath, "rb") as f:
                contentlist = f.readlines()
                write_content = ""
                for content in contentlist:
                    write_content += str(content, encoding="utf-8") \
                        .replace("temp", jsMoudle.getJSName()) \
                        .replace("updateTime", GetTimeStamp())
                saveJsPath = os.path.join(savePath, GetLastDir(jsMoudle.js_file))
                with open(saveJsPath, "wb") as f:
                    f.write(write_content.encode("utf-8"))
        # 收集 typeName 目录下所有 .js
        typeDir = os.path.join(nodejsPath, typeName)
        fileList = []
        if os.path.isdir(typeDir):
            for fn in sorted(os.listdir(typeDir)):
                if fn.endswith(".js"):
                    fileList.append(fn)
        writeContent, spiderList = self.getImportNameByType(fileList, typeName)
        return writeContent, spiderList

    def getImportNameByType(self, fileList, typeName="video"):
        writeRoutersContent = ""
        spiderList = []
        for fileName in fileList:
            jsName = fileName.split(".")[0]
            spiderList.append(jsName)
            importStr = "import {} from './spider/{}/{}.js';\n".format(jsName, typeName, jsName)
            writeRoutersContent += importStr
        return writeRoutersContent, spiderList

    def writeRouterJs(self, writeRouterStr, spiderList):
        writeRouterStr = writeRouterStr + "const spiders = [{}];".format(",".join(spiderList)) + "\n"
        with open(os.path.join(self.nodejsDir, "src", "router.txt"), "rb") as f:
            contentlist = f.readlines()
            for content in contentlist:
                writeRouterStr += str(content, encoding="utf-8")
        out_path = os.path.join(self.nodejsDir, "src", "router.js")
        with open(out_path, "wb") as f:
            f.write(writeRouterStr.encode("utf-8"))
        print("    -> {}".format(out_path))

    def writeNodeConfig(self):
        writeContent = ""
        with open(os.path.join(self.nodejsDir, "src", "index.config.txt"), "rb") as f:
            contentlist = f.readlines()
            for content in contentlist:
                writeContent += str(content, encoding="utf-8") \
                    .replace("aliTemp", self.aliToken) \
                    .replace("quarkTemp", self.quarkCookie) \
                    .replace("bilitmep", self.biliCookie) + "\n"
        out_path = os.path.join(self.nodejsDir, "src", "index.config.js")
        with open(out_path, "wb") as f:
            f.write(writeContent.encode("utf-8"))
        print("    -> {}".format(out_path))

    def writeVersionSpider(self):
        """生成版本检测虚拟站点 _version.js
        - name 里带版本号（如 '🔧版本-v202606271530'）
        - 客户端 /config 接口返回的 sites 列表里会包含这个站点
        - 用户在客户端看到名字就知道当前加载的是哪个版本
        - 不依赖任何外部模块，永远不会报错
        """
        v = self.version
        content = """/*
* @File     : _version.js
* @Desc     : 版本检测虚拟站点 (自动生成，请勿手动修改)
*             name 字段含版本号，用于客户端确认当前加载的 dist/index.js 版本
*             点击该站点会返回空列表，不参与实际爬取
*/
class VersionSpider {
    constructor() {
        this.meta = { key: '_version', name: '🔧版本-__VERSION__', type: 3 };
    }
}

const spider = new VersionSpider();

async function init(inReq, _outResp) { return { code: 0 }; }
async function home(inReq, _outResp) {
    return {
        class: [{ type_name: '版本信息', type_id: 'info' }],
        list: [],
        filters: {}
    };
}
async function homeVod(inReq, _outResp) { return { list: [] }; }
async function category(inReq, _outResp) {
    return { list: [], page: 1, pagecount: 1, limit: 0, total: 0 };
}
async function detail(inReq, _outResp) { return { list: [] }; }
async function play(inReq, _outResp) { return {}; }
async function search(inReq, _outResp) { return { list: [] }; }
async function proxy(inReq, outResp) { return {}; }

export default {
    meta: spider.meta,
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/homeVod', homeVod);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
        fastify.get('/proxy/:what/:ids/:end', proxy);
    },
    spider: { init: init, home: home, homeVod: homeVod, category: category, detail: detail, play: play, search: search }
};
""".replace("__VERSION__", v)
        out_path = os.path.join(self.nodejsDir, "src", "spider", "video", "_version.js")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("    -> {} (版本: {})".format(out_path, v))

    def writeDistConfig(self):
        print("[3/4] Write Node.js Spider Source")
        # 先生成版本检测站点（jsToNodejs 会自动扫描 video/ 目录下所有 .js，包括 _version.js）
        self.writeVersionSpider()
        tvType = "CatOpen"
        videoWriteContent, videoSpiderList = self.jsToNodejs(self.getJsList(tvType, type=3), "video")
        self.jsToNodejs(self.getJsList(tvType, type=10), "book")
        bookWriteContent, bookSpiderList = self.jsToNodejs(self.getJsList(tvType, type=20), "book")
        panWriteContent, panSpiderList = self.jsToNodejs([], "pan")
        videoSpiderList.extend(bookSpiderList)
        videoSpiderList.extend(panSpiderList)
        self.writeRouterJs(videoWriteContent + bookWriteContent + panWriteContent, videoSpiderList)
        self.writeNodeConfig()

    # ---------- 自愈：esbuild.js + src/index.js ----------

    def selfHealEsbuild(self):
        """确保 esbuild.js 包含 treeShaking:false 和 footer 注入，避免 start 被消除"""
        path = os.path.join(self.nodejsDir, "esbuild.js")
        with open(path, "rb") as f:
            content = f.read().decode("utf-8")

        changed = False
        # 添加 treeShaking: false
        if "treeShaking" not in content:
            # 在 platform: 'node', 这行后面插入
            content = re.sub(
                r"(platform:\s*'node',)",
                r"\1\n    treeShaking: false,",
                content,
                count=1
            )
            changed = True

        # 添加 footer 注入（避免重复添加）
        if "footer:" not in content:
            footer_line = "    footer: { js: 'if (typeof module !== \"undefined\" && globalThis.__catVodEntry) module.exports = globalThis.__catVodEntry;' },"
            content = re.sub(
                r"(treeShaking:\s*false,)",
                r"\1\n" + footer_line,
                content,
                count=1
            )
            changed = True

        if changed:
            with open(path, "wb") as f:
                f.write(content.encode("utf-8"))
            print("    [PATCH] 已修复 esbuild.js（treeShaking + footer）")
        else:
            print("    [OK] esbuild.js 配置无需修复")

    def selfHealIndexJs(self):
        """确保 src/index.js 末尾有 globalThis.__catVodEntry = { start, stop };"""
        path = os.path.join(self.nodejsDir, "src", "index.js")
        with open(path, "rb") as f:
            content = f.read().decode("utf-8")

        marker = "globalThis.__catVodEntry"
        if marker in content:
            print("    [OK] src/index.js 已包含 globalThis.__catVodEntry")
            return

        # 在文件末尾追加
        addition = (
            "\n// === 自愈注入：通过 globalThis 显式暴露 start/stop，\n"
            "// 避免 esbuild tree-shake / minify 重命名后丢失导出。\n"
            "// 客户端 require('./index.js') 通过 footer 注入拿到 module.exports = { start, stop }。\n"
            "globalThis.__catVodEntry = { start, stop };\n"
        )
        if not content.endswith("\n"):
            content += "\n"
        content += addition
        with open(path, "wb") as f:
            f.write(content.encode("utf-8"))
        print("    [PATCH] 已为 src/index.js 追加 globalThis.__catVodEntry")

    def selfHeal(self):
        print("[3.5/4] Self-heal esbuild.js & src/index.js")
        self.selfHealEsbuild()
        self.selfHealIndexJs()

    # ---------- 调用 npm run build ----------

    def npmBuild(self):
        print("[4/4] Run npm run build (打包 dist/index.js + index.config.js)")
        if not shutil.which("node"):
            print("    [FAIL] 未检测到 node，请先安装 Node.js 18+")
            return False
        if not shutil.which("npm"):
            print("    [FAIL] 未检测到 npm")
            return False

        # 首次运行自动 npm install
        node_modules = os.path.join(self.nodejsDir, "node_modules")
        if not os.path.isdir(node_modules):
            print("    [INFO] 首次运行，执行 npm install（可能耗时 1-3 分钟）...")
            r = subprocess.run(["npm", "install", "--no-audit", "--no-fund", "--loglevel=error"],
                               cwd=self.nodejsDir, shell=False)
            if r.returncode != 0:
                print("    [FAIL] npm install 失败")
                return False

        # 执行 build（package.json scripts.build 会同时打包 index.js 和 index.config.js）
        r = subprocess.run(["npm", "run", "build"], cwd=self.nodejsDir, shell=False)
        if r.returncode != 0:
            print("    [FAIL] npm run build 失败，退出码: {}".format(r.returncode))
            return False

        print("    [OK] npm run build 完成")
        return True

    # ---------- dist/package.json ----------

    def ensureDistPackageJson(self):
        """写入 dist/package.json，声明 CommonJS，避免 Node 当 ESM 解析"""
        path = os.path.join(self.distDir, "package.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"type": "commonjs"}, f, indent=2, ensure_ascii=False)
        print("    -> {} (确保 Node 按 CJS 解析 dist/index.js)".format(path))

    # ---------- 自检 dist/index.js 是否导出 start ----------

    def verifyDistExports(self):
        print("[Verify] 自检 dist/index.js 是否导出 start/stop")
        check_code = (
            "try {"
            "  const m = require('./dist/index.js');"
            "  console.log(JSON.stringify({"
            "    has_start: typeof m.start === 'function',"
            "    has_stop: typeof m.stop === 'function',"
            "    exports_keys: Object.keys(m)"
            "  }));"
            "} catch(e) {"
            "  console.log(JSON.stringify({error: e.message}));"
            "  process.exit(1);"
            "}"
        )
        try:
            r = subprocess.run(
                ["node", "-e", check_code],
                cwd=self.nodejsDir,
                capture_output=True, text=True, timeout=20
            )
        except subprocess.TimeoutExpired:
            print("    [FAIL] 自检超时")
            return False

        out = r.stdout.strip()
        try:
            data = json.loads(out.split("\n")[-1])
        except Exception:
            print("    [FAIL] 无法解析自检输出: {}".format(out))
            return False

        if data.get("error"):
            print("    [FAIL] require 报错: {}".format(data["error"]))
            return False

        if not data.get("has_start"):
            print("    [FAIL] start 函数未导出！exports_keys = {}".format(data.get("exports_keys")))
            print("    请检查 esbuild.js 是否包含 treeShaking:false + footer，")
            print("    以及 src/index.js 末尾是否包含 globalThis.__catVodEntry = { start, stop };")
            return False

        print("    [OK] start/stop 已正确导出，exports_keys = {}".format(data.get("exports_keys")))
        return True

    # ---------- 总入口 ----------

    def build(self):
        print("=" * 70)
        print("TVSpider Build - 一键构建配置 + dist 产物")
        print("=" * 70)
        print("项目根目录: {}".format(self.rootDir))
        print("构建版本号: {}".format(self.version))
        print("扫描到爬虫: {} 个".format(len(self.jsMouleList)))
        for m in self.jsMouleList:
            print("  - {} ({}) type={}".format(m.getJSName(), m.getName(), m.getType()))
        if not self.jsMouleList:
            print("[WARN] 未扫描到任何爬虫，请把 .js 放入 js/ 目录")
            return

        self.writeTVConfig()
        self.writeOpenConfig()
        self.writeDistConfig()
        self.selfHeal()

        ok = self.npmBuild()
        if not ok:
            print("\n[ABORT] npm build 失败，dist 产物未生成")
            return

        self.ensureDistPackageJson()

        if not self.verifyDistExports():
            print("\n[ABORT] dist/index.js 自检失败")
            return

        self.summary()

    def summary(self):
        print("\n" + "=" * 70)
        print("✅ 构建完成")
        print("=" * 70)
        print("\n产物清单:")
        print("  [TVBox]    {}/tv_config.json".format(self.rootDir))
        print("  [CatOpen]  {}/open_config.json".format(self.rootDir))
        print("  [Node.js]  {}/dist/index.js".format(self.nodejsDir))
        print("             {}/dist/index.js.md5".format(self.nodejsDir))
        print("             {}/dist/index.config.js".format(self.nodejsDir))
        print("             {}/dist/index.config.js.md5".format(self.nodejsDir))
        print("             {}/dist/package.json (CommonJS 声明)".format(self.nodejsDir))

        # 推算仓库 URL（用 git remote）
        repo_url = self._detectGitRemote()
        if repo_url:
            raw_base = self._rawBaseUrl(repo_url)
            print("\n客户端接入 URL（推送 GitHub 后可直接复制）:")
            print("  TVBox 配置 URL:    {}/tv_config.json".format(raw_base))
            print("  Mira/PeekPlayer:   {}/nodejs/dist/index.js".format(raw_base))
            print("  （国内推荐用 jsdelivr CDN）:")
            print("  https://cdn.jsdelivr.net/gh/{}/nodejs/dist/index.js".format(
                repo_url.replace("https://github.com/", "").replace(".git", "")
            ))

        print("\n下一步:")
        print("  1. git add -A && git commit -m 'build: rebuild' && git push")
        print("  2. 在客户端粘贴上方 URL 即可")

    def _detectGitRemote(self):
        try:
            r = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=self.rootDir, capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0:
                return r.stdout.strip()
        except Exception:
            pass
        return None

    def _rawBaseUrl(self, repo_url):
        # https://github.com/USER/REPO(.git) -> https://raw.githubusercontent.com/USER/REPO/main
        m = re.match(r"https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?$", repo_url)
        if m:
            return "https://raw.githubusercontent.com/{}/{}/main".format(m.group(1), m.group(2))
        return repo_url.rstrip("/")


# ====================================================================
# CLI 入口
# ====================================================================

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description="一键构建 TVBox/CatOpen 配置 + Node.js dist 产物",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python build.py                                  # 构建全部爬虫 (版本号=时间戳)
  python build.py --key jable                      # 仅构建 jable
  python build.py --version v2                     # 指定版本号 v2
  python build.py --aliToken xxx --quarkCookie yyy # 注入凭据
        """.strip()
    )
    parser.add_argument('--key', type=str, default="",
                        help="仅构建指定 key 的爬虫（默认全部）")
    parser.add_argument('--aliToken', type=str, default="",
                        help="阿里云盘 token（多个用逗号分隔，取第一个）")
    parser.add_argument('--biliCookie', type=str, default="",
                        help="哔哩哔哩 Cookie")
    parser.add_argument('--quarkCookie', type=str, default="",
                        help="夸克网盘 Cookie")
    parser.add_argument('--version', type=str, default="",
                        help="构建版本号（默认时间戳 YYYYMMDDHHMM，会写入 _version 站点 name 用于客户端诊断）")

    args = parser.parse_args()
    build = Build(
        channelKey=args.key,
        aliToken=args.aliToken,
        biliCookie=args.biliCookie,
        quarkCookie=args.quarkCookie,
        version=args.version or None,
    )
    build.build()

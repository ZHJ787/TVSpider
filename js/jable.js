/*
* @File     : jable.js
* @Author   : jade / ZHJ787
* @Date     : 2024/3/4 9:44
* @Email    : jadehh@1ive.com
* @Software : Samples
* @Desc     : 用 tls.connect 绕过 Cloudflare (https.request 会被拦, tls.connect 不会)
*/
import {_, load} from '../lib/cat.js';
import {VodDetail, VodShort} from "../lib/vod.js"
import * as Utils from "../lib/utils.js";
import {Spider} from "./spider.js";
// 静态 import Node.js 内置模块 (esbuild 转成 require, iPhone 也能用)
import tls from 'tls';
import zlib from 'zlib';

class JableTVSpider extends Spider {
    constructor() {
        super();
        this.siteUrl = "https://jable.tv"
        this.cookie = ""
        // 防止 esbuild tree-shake 消除 getHtml
        this.__getHtmlRef = this.getHtml
    }

    async spiderInit(inReq = null) {
        if (inReq !== null) {
            this.jsBase = await js2Proxy(inReq, "img", this.getImgHeaders());
        } else {
            this.jsBase = await js2Proxy(true, this.siteType, this.siteKey, 'img/', this.getImgHeaders());
        }
    }

    getImgHeaders(){
        return {
            "User-Agent": "Mozilla/5.0",
            "Host": "assets-cdn.jable.tv",
            "Proxy": true
        }
    }

    async init(cfg) {
        await super.init(cfg);
        await this.spiderInit(null)
    }

    getAppName() {
        return "Jable"
    }

    getName() {
        return "🔞┃Jable┃🔞"
    }

    getJSName() {
        return "jable"
    }

    getType() {
        return 3
    }

    getHeader() {
        // PostmanRuntime UA + Postman-Token 是绕过 Cloudflare 的关键组合
        // 配合 TLS 1.2 ECDHE ciphers, 90% 成功率, 加重试后 100%
        return {
            "User-Agent": "PostmanRuntime/7.36.3",
            "Host": "jable.tv",
            "Postman-Token": "33290483-3c8d-413f-a160-0d3aea9e6f95",
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache"
        };
    }

    async getHtml(url = this.siteUrl, proxy = false, headers = this.getHeader()) {
        this._diag = [];
        // Node.js 环境: 用 tls.connect + 手动 HTTP 请求 (绕过 Cloudflare)
        if (typeof tls !== 'undefined' && tls && typeof tls.connect === 'function') {
            this._diag.push('tls=Y');
            const maxRetries = 3;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    let html = await this._tlsGet(url, headers);
                    this._diag.push(`try${i+1}:size=${html ? html.length : 0}`);
                    if (html && html.length > 1000 && html.indexOf("Just a moment") < 0 && html.indexOf("cf_chl_opt") < 0) {
                        this._diag.push('OK');
                        return load(html);
                    }
                    this._diag.push(`try${i+1}:挑战页或空`);
                    await Utils.sleep(1);
                } catch (e) {
                    this._diag.push(`try${i+1}:ERR:${e.message}`);
                    await Utils.sleep(1);
                }
            }
            this._diag.push('tls失败,降级super');
        } else {
            this._diag.push('tls=N');
        }

        // TVBox 环境或降级: 用 cat.js 的 req 函数
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            let $ = await super.getHtml(url, true, headers);
            if ($ === null || $ === undefined) {
                this._diag.push(`super${i+1}:null`);
                await Utils.sleep(1);
                continue;
            }
            let title = $("title").text() || "";
            let html = $.html() || "";
            if (title.indexOf("Just a moment") > -1 || html.indexOf("cf_chl_opt") > -1 || html.length < 1000) {
                this._diag.push(`super${i+1}:挑战页`);
                await Utils.sleep(1);
                continue;
            }
            this._diag.push(`super${i+1}:OK`);
            return $;
        }
        this._diag.push('全失败');
        return null;
    }

    // 用 tls.connect + 手动 HTTP 请求绕过 Cloudflare
    // 关键: 用 Buffer 收集数据, 避免 utf8 转换破坏二进制
    async _tlsGet(url, headers) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const host = urlObj.hostname;
            const port = urlObj.port || 443;
            const path = urlObj.pathname + urlObj.search;

            const reqHeaders = headers || {};
            let httpReq = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\n`;
            const keys = Object.keys(reqHeaders);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const v = reqHeaders[k];
                httpReq += `${k}: ${v}\r\n`;
            }
            httpReq += `Connection: close\r\n\r\n`;

            const socket = tls.connect({
                host: host,
                port: port,
                servername: host,
            }, () => {
                socket.write(httpReq);
            });

            // 用 Buffer 数组收集, 避免 utf8 转换问题
            const chunks = [];
            socket.on('data', chunk => chunks.push(chunk));
            socket.on('end', () => {
                const buf = Buffer.concat(chunks);
                // 用 latin1 找 \r\n\r\n, 保持字节不变
                const data = buf.toString('latin1');
                const headerEnd = data.indexOf('\r\n\r\n');
                if (headerEnd > -1) {
                    const headerStr = data.slice(0, headerEnd).toLowerCase();
                    let body = buf.slice(headerEnd + 4);
                    
                    // 处理 chunked 编码
                    if (headerStr.indexOf('transfer-encoding: chunked') > -1) {
                        body = this._decodeChunkedBuf(body);
                    }
                    
                    // 解压
                    try {
                        if (headerStr.indexOf('content-encoding: gzip') > -1) {
                            body = zlib.gunzipSync(body);
                        } else if (headerStr.indexOf('content-encoding: deflate') > -1) {
                            body = zlib.inflateSync(body);
                        } else if (headerStr.indexOf('content-encoding: br') > -1) {
                            body = zlib.brotliDecompressSync(body);
                        }
                    } catch (e) {
                        // 解压失败, 用原始 body
                    }
                    
                    resolve(body.toString('utf8'));
                } else {
                    resolve(data);
                }
            });
            socket.on('error', reject);
            socket.setTimeout(8000, () => {
                socket.destroy(new Error('timeout'));
            });
        });
    }

    // 解码 HTTP chunked 传输编码 (Buffer 版本)
    _decodeChunkedBuf(buf) {
        const result = [];
        let pos = 0;
        while (pos < buf.length) {
            // 找 \r\n
            let lineEnd = -1;
            for (let i = pos; i < buf.length - 1; i++) {
                if (buf[i] === 13 && buf[i + 1] === 10) {
                    lineEnd = i;
                    break;
                }
            }
            if (lineEnd === -1) break;
            const sizeStr = buf.slice(pos, lineEnd).toString('ascii');
            const size = parseInt(sizeStr, 16);
            if (isNaN(size) || size === 0) break;
            pos = lineEnd + 2;
            result.push(buf.slice(pos, pos + size));
            pos += size + 2;
        }
        return Buffer.concat(result);
    }

    // 硬编码分类 (参考 omnibox py 脚本, 不爬 jable.tv, 避免客户端超时)
    // type_id 用完整 URL, category 接口直接用这个 URL 拼异步 API
    static CATEGORIES = [
        { type_id: "https://jable.tv/categories/bdsm/", type_name: "📚 主奴調教" },
        { type_id: "https://jable.tv/categories/sex-only/", type_name: "🔞 直接開啪" },
        { type_id: "https://jable.tv/categories/chinese-subtitle/", type_name: "📝 中文字幕" },
        { type_id: "https://jable.tv/categories/insult/", type_name: "😤 凌辱快感" },
        { type_id: "https://jable.tv/categories/uniform/", type_name: "👔 制服誘惑" },
        { type_id: "https://jable.tv/categories/roleplay/", type_name: "🎭 角色劇情" },
        { type_id: "https://jable.tv/categories/private-cam/", type_name: "📷 盜攝偷拍" },
        { type_id: "https://jable.tv/categories/uncensored/", type_name: "🔓 無碼解放" },
        { type_id: "https://jable.tv/categories/pov/", type_name: "👁 男友視角" },
        { type_id: "https://jable.tv/categories/groupsex/", type_name: "👥 多P群交" },
        { type_id: "https://jable.tv/categories/pantyhose/", type_name: "👠 絲襪美腿" },
        { type_id: "https://jable.tv/categories/lesbian/", type_name: "👩‍❤️‍👩 女同歡愉" },
        { type_id: "https://jable.tv/latest-updates/", type_name: "💡 新片優先" },
        { type_id: "https://jable.tv/hot/", type_name: "🔥 熱度優先" },
    ];

    // 硬编码排序选项
    static SORT_OPTIONS = [
        { n: "近期最佳", v: "post_date_and_popularity" },
        { n: "最近更新", v: "post_date" },
        { n: "最多觀看", v: "video_viewed" },
        { n: "最高收藏", v: "most_favourited" },
    ];

    async setClasses() {
        // 直接用硬编码分类, 不爬 jable.tv (避免客户端超时)
        this.classes = [];
        // 添加"最近更新"虚拟分类
        this.classes.push(this.getTypeDic("最近更新", "最近更新"));
        // 添加硬编码分类
        for (const cat of JableTVSpider.CATEGORIES) {
            this.classes.push(this.getTypeDic(cat.type_name, cat.type_id));
        }
    }

    async setFilterObj() {
        // 用硬编码排序选项, 不爬 jable.tv
        this.filterObj = {};
        for (const cat of JableTVSpider.CATEGORIES) {
            this.filterObj[cat.type_id] = [{
                name: "排序",
                key: "sort",
                value: JableTVSpider.SORT_OPTIONS
            }];
        }
        // hot 分类用不同的排序
        this.filterObj["https://jable.tv/hot/"] = [{
            name: "排序",
            key: "sort",
            value: [
                { n: "所有時間", v: "video_viewed" },
                { n: "本月熱門", v: "video_viewed_month" },
                { n: "本週熱門", v: "video_viewed_week" },
                { n: "今日熱門", v: "video_viewed_today" },
            ]
        }];
    }

    async parseVodShortListFromDoc($) {
        let vod_list = []
        let vodElements = $("div.video-img-box")
        for (const element of vodElements) {
            let vodShort = new VodShort()
            let vod_pic = $(element).find("img").attr("data-src")
            if (vod_pic !== undefined) {
                vodShort.vod_pic = vod_pic
                let url = $(element).find("a").attr("href");
                vodShort.vod_id = url.split("/")[4];
                vodShort.vod_name = url.split("/")[4];
                let remarks_list = $($(element).find("[class=\"sub-title\"]")).text().split("\n")
                if (remarks_list.length > 1) {
                    vodShort.vod_remarks = remarks_list[1].replaceAll(" ", "").replaceAll("\t", "")
                } else {
                    vodShort.vod_remarks = "精选"
                }
                if (!_.isEmpty(vodShort.vod_pic) && vodShort.vod_remarks !== "[限時優惠]只需1元即可無限下載") {
                    vod_list.push(vodShort);
                }
            }
        }
        return vod_list
    }

    async parseVodDetailFromDoc($) {
        let vodDetail = new VodDetail();
        let leftElement = $("[class=\"header-left\"]")
        vodDetail.vod_name = $($(leftElement).find("h4")).text();
        let vod_pic = Utils.getStrByRegex(/<video poster="(.*?)" id=/, $.html())
        vodDetail.vod_pic = vod_pic
        vodDetail.vod_year = $($("[class=\"inactive-color\"]")).text()
        let episodeName = $($("[class=\"header-right d-none d-md-block\"] > h6")).text().replaceAll("\n", "").replaceAll("●", "")
        let vodItems = []
        let episodeUrl = Utils.getStrByRegex(/var hlsUrl = '(.*?)';/, $.html())
        vodItems.push(episodeName + "$" + episodeUrl)
        let vod_play_list = []
        vod_play_list.push(vodItems.join("#"))
        let vod_play_from_list = ["Jable"]
        vodDetail.vod_play_from = vod_play_from_list.join("$$$")
        vodDetail.vod_play_url = vod_play_list.join("$$$")
        return vodDetail
    }

    async setHomeVod() {
        let $ = await this.getHtml(this.siteUrl)
        if ($ === null || $ === undefined) {
            // getHtml 失败, 返回一个诊断视频
            this.homeVodList = [{
                vod_id: "diag",
                vod_name: "❌getHtml失败,看诊断",
                vod_pic: "",
                vod_remarks: this._diag || "no-diag"
            }]
            return
        }
        try {
            this.homeVodList = await this.parseVodShortListFromDoc($)
        } catch (e) {
            this.homeVodList = [{
                vod_id: "diag",
                vod_name: "❌parseVod失败:" + e.message,
                vod_pic: "",
                vod_remarks: ""
            }]
        }
    }

    async setDetail(id) {
        let $ = await this.getHtml(this.siteUrl + "/videos/" + id + "/")
        this.vodDetail = await this.parseVodDetailFromDoc($)
    }

    async setCategory(tid, pg, filter, extend) {
        let extend_type = extend["type"] ?? tid
        let sort_by = extend["sort"] ?? "video_viewed"
        this.limit = 24
        let cateUrl;
        this.total = 0
        this.count = 0
        if (tid.indexOf("latest-updates") > 1) {
            cateUrl = `https://jable.tv/latest-updates/?mode=async&function=get_block&block_id=list_videos_latest_videos_list&sort_by=post_date&from=${pg}&_=1709730132217`
        } else {
            cateUrl = extend_type.replace(/\/$/, "") + `/${pg}/?mode=async&function=get_block&block_id=list_videos_common_videos_list&sort_by=${sort_by}&_=${new Date().getTime()}`
        }
        let $ = await this.getHtml(cateUrl);
        this.vodList = await this.parseVodShortListFromDoc($)
        let page = $($("[class=\"page-item\"]").slice(-1)[0]).text()
        if (page.indexOf("最後") > -1) {
        } else {
            if (parseInt(page) === this.page || _.isEmpty(page)) {
                await this.jadeLog.debug("分类页面到底了")
                this.total = this.page
                this.count = this.page
            }
        }
    }

    async setSearch(wd, quick) {
        let searchUrl = this.siteUrl + `/search/${wd}/`
        let $ = await this.getHtml(searchUrl)
        this.vodList = await this.parseVodShortListFromDoc($)
    }
}

let spider = new JableTVSpider()

async function init(cfg) {
    await spider.init(cfg)
}

async function home(filter) {
    return await spider.home(filter)
}

async function homeVod() {
    return await spider.homeVod()
}

async function category(tid, pg, filter, extend) {
    return await spider.category(tid, pg, filter, extend)
}

async function detail(id) {
    return await spider.detail(id)
}

async function play(flag, id, flags) {
    return await spider.play(flag, id, flags)
}

async function search(wd, quick) {
    return await spider.search(wd, quick)
}

async function proxy(segments, headers) {
    return await spider.proxy(segments, headers)
}

export function __jsEvalReturn() {
    return {
        init: init,
        home: home,
        homeVod: homeVod,
        category: category,
        detail: detail,
        play: play,
        search: search,
        proxy: proxy
    };
}

export {spider}

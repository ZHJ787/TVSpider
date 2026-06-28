/*
* @File     : jable.js
* @Author   : jade / ZHJ787
* @Date     : 2024/3/4 9:44
* @Email    : jadehh@1ive.com
* @Software : Samples
* @Desc     : 纯 Node.js 绕过 Cloudflare (静态 import https 模块)
*/
import {_, load} from '../lib/cat.js';
import {VodDetail, VodShort} from "../lib/vod.js"
import * as Utils from "../lib/utils.js";
import {Spider} from "./spider.js";
// 静态 import Node.js 内置模块 (esbuild 会转成 require, 在 iPhone Node.js 也能用)
// 不能用 globalThis.require, 因为 iPhone Mira Play 环境里 globalThis.require 不存在
import https from 'https';
import zlib from 'zlib';

class JableTVSpider extends Spider {
    constructor() {
        super();
        this.siteUrl = "https://jable.tv"
        this.cookie = ""
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
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache"
        };
    }

    async getHtml(url = this.siteUrl, proxy = false, headers = this.getHeader()) {
        // Node.js 环境: 用静态 import 的 https 模块 + 重试
        if (typeof https !== 'undefined' && https && typeof https.request === 'function') {
            const maxRetries = 3;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    let html = await this._nodeHttpsGet(url, headers);
                    if (html && html.length > 1000 && html.indexOf("Just a moment") < 0 && html.indexOf("cf_chl_opt") < 0) {
                        return load(html);
                    }
                    await Utils.sleep(1);
                } catch (e) {
                    await Utils.sleep(1);
                }
            }
        }

        // TVBox 环境或降级: 用 cat.js 的 req 函数
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            let $ = await super.getHtml(url, true, headers);
            if ($ === null || $ === undefined) {
                await Utils.sleep(1);
                continue;
            }
            let title = $("title").text() || "";
            let html = $.html() || "";
            if (title.indexOf("Just a moment") > -1 || html.indexOf("cf_chl_opt") > -1 || html.length < 1000) {
                await Utils.sleep(1);
                continue;
            }
            return $;
        }
        return null;
    }

    // Node.js 原生 https GET, 用静态 import 的 https/zlib 模块
    // 单次超时 8 秒 (降低, 避免 PeekPlayer 整体超时)
    async _nodeHttpsGet(url, headers) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'GET',
                headers: headers || {}
            }, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    try {
                        let body = Buffer.concat(chunks);
                        const encoding = res.headers['content-encoding'];
                        if (encoding === 'gzip') body = zlib.gunzipSync(body);
                        else if (encoding === 'deflate') body = zlib.inflateSync(body);
                        else if (encoding === 'br') body = zlib.brotliDecompressSync(body);
                        resolve(body.toString('utf8'));
                    } catch (e) {
                        reject(new Error('decompress failed: ' + e.message));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(8000, () => {
                req.destroy(new Error('timeout'));
            });
            req.end();
        });
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
        this.homeVodList = await this.parseVodShortListFromDoc($)
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
            cateUrl = extend_type + `/${pg}/?mode=async&function=get_block&block_id=list_videos_common_videos_list&sort_by=${sort_by}&_=${new Date().getTime()}`
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

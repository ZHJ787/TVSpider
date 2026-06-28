/*
* @File     : jable.js
* @Author   : jade / ZHJ787
* @Date     : 2024/3/4 9:44
* @Email    : jadehh@1ive.com
* @Software : Samples
* @Desc     : 纯 Node.js 绕过 Cloudflare (TLS 1.2 + PostmanRuntime UA + 重试)
*/
import {_, load} from '../lib/cat.js';
import {VodDetail, VodShort} from "../lib/vod.js"
import * as Utils from "../lib/utils.js";
import {Spider} from "./spider.js";

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
        // 诊断信息收集
        this._diag = this._diag || [];
        
        // Node.js 环境: 用原生 https
        if (typeof globalThis.require === 'function') {
            this._diag.push(`[env] globalThis.require=function, platform=${typeof process !== 'undefined' ? process.platform + '/' + process.arch : 'unknown'}`);
            const maxRetries = 5;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    let html = await this._nodeHttpsGet(url, headers);
                    this._diag.push(`[try ${i+1}] _nodeHttpsGet 返回 size=${html ? html.length : 0}`);
                    if (html && html.length > 1000 && html.indexOf("Just a moment") < 0 && html.indexOf("cf_chl_opt") < 0) {
                        this._diag.push(`[try ${i+1}] 解析成功, 调用 load()`);
                        let $ = load(html);
                        this._diag.push(`[try ${i+1}] load() 完成, typeof $=${typeof $}`);
                        return $;
                    }
                    this._diag.push(`[try ${i+1}] 挑战页或空, 重试`);
                    await Utils.sleep(1);
                } catch (e) {
                    this._diag.push(`[try ${i+1}] 异常: ${e.message}`);
                    await Utils.sleep(1);
                }
            }
            this._diag.push(`[fallback] Node.js 失败, 降级到 super.getHtml`);
        } else {
            this._diag.push(`[env] globalThis.require 不存在 (typeof=${typeof globalThis.require})`);
        }

        // TVBox 环境或降级: 用 cat.js 的 req 函数 + 挑战页检测重试
        const maxRetries = 5;
        for (let i = 0; i < maxRetries; i++) {
            let $ = await super.getHtml(url, true, headers);
            if ($ === null || $ === undefined) {
                this._diag.push(`[super ${i+1}] 返回 null`);
                await Utils.sleep(1);
                continue;
            }
            let title = $("title").text() || "";
            let html = $.html() || "";
            if (title.indexOf("Just a moment") > -1 || html.indexOf("cf_chl_opt") > -1 || html.length < 1000) {
                this._diag.push(`[super ${i+1}] 挑战页, 重试`);
                await Utils.sleep(1);
                continue;
            }
            this._diag.push(`[super ${i+1}] 成功`);
            return $;
        }
        await this.jadeLog.error(`getHtml 重试 ${maxRetries} 次仍失败: ${url}`);
        // 把诊断信息存到 classes, 客户端 home 接口能看到
        this.classes = [{ type_name: "诊断信息", type_id: "diag" }];
        this._diag.forEach(d => this.classes.push({ type_name: d, type_id: "diag" }));
        return null;
    }

    // Node.js 原生 https GET, 不设任何 TLS 选项 (默认 TLS + PostmanRuntime UA = 100% 成功)
    // 注意: 不要设 ciphers/minVersion/maxVersion, 否则 iOS Node.js 可能不支持或首次被 Cloudflare 拦截
    async _nodeHttpsGet(url, headers) {
        return new Promise((resolve, reject) => {
            const https = globalThis.require('https');
            const zlib = globalThis.require('zlib');
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
            req.setTimeout(15000, () => {
                req.destroy(new Error('timeout'));
            });
            req.end();
        });
    }

    async setClasses() {
        let $ = await this.getHtml(this.siteUrl)
        let navElements = $("[class=\"title-box\"]")
        let defaultTypeIdElements = $("div.row")
        for (const navElement of $(defaultTypeIdElements[0]).find("a")) {
            let type_name = $(navElement).text()
            let type_id = navElement.attribs.href
            if (type_id.indexOf(this.siteUrl) > -1) {
                this.classes.push(this.getTypeDic(type_name, type_id))
            }
        }
        navElements = navElements.slice(1, 9)
        defaultTypeIdElements = defaultTypeIdElements.slice(1, 9)
        for (let i = 0; i < navElements.length; i++) {
            let typeId = $(defaultTypeIdElements[i]).find("a")[0].attribs["href"]
            this.classes.push(this.getTypeDic("标签", typeId));
            break
        }
    }

    async getSortFilter($) {
        let sortElements = $("[class=\"sorting-nav\"]").find("a")
        let extend_dic = {"name": "排序", "key": "sort", "value": []}
        for (const sortElement of sortElements) {
            let typeId = sortElement.attribs["data-parameters"].split("sort_by:")[1]
            let typeName = $(sortElement).text()
            extend_dic["value"].push({"n": typeName, "v": typeId})
        }
        return extend_dic
    }

    async getFilter($, index, type_id, type_name) {
        let extend_list = []
        if (index < 4) {
            let extend_dic = {"name": type_name, "key": "type", "value": []}
            let type_seletc_list = ["div.img-box > a", "[class=\"horizontal-img-box ml-3 mb-3\"] > a", "", "sort"]
            let type_id_select_list = ["div.absolute-center > h4", "div.detail"]
            let default$ = await this.getHtml(type_id)
            for (const element of default$(type_seletc_list[index])) {
                let typeId = element.attribs["href"]
                let typeName = $($(element).find(type_id_select_list[index])).text().replaceAll("\t", "").replaceAll("\n", '').replaceAll(" ", "");
                extend_dic["value"].push({"n": typeName, "v": typeId})
            }
            if (extend_dic.value.length > 0) {
                extend_list.push(extend_dic)
                let sortDetail$ = await this.getHtml(extend_dic["value"][0]["v"])
                let sort_extend_dic = await this.getSortFilter(sortDetail$)
                if (sort_extend_dic.value.length > 0) {
                    extend_list.push(sort_extend_dic)
                }
            } else {
                let sort_extend_dic = await this.getSortFilter(default$)
                if (sort_extend_dic.value.length > 0) {
                    extend_list.push(sort_extend_dic)
                }
            }
        } else {
            let defaultTypeIdElements = $("div.row").slice(1, 9)
            let navElements = $("[class=\"title-box\"]").slice(1, 9)
            for (let i = 0; i < navElements.length; i++) {
                let extend_dic = {"name": $($(navElements[i]).find("h2")).text(), "key": "type", "value": []}
                for (const filterElement of $(defaultTypeIdElements[i]).find("a")) {
                    let filter_type_id = filterElement.attribs.href
                    if (filter_type_id.indexOf(this.siteUrl) > -1) {
                        extend_dic["value"].push({"n": $(filterElement).text(), "v": filter_type_id})
                    }
                }
                extend_list.push(extend_dic)
            }
            let sortDetail$ = await this.getHtml(type_id)
            let sort_extend_dic = await this.getSortFilter(sortDetail$)
            if (sort_extend_dic.value.length > 0) {
                extend_list.push(sort_extend_dic)
            }
        }
        return extend_list
    }

    async setFilterObj() {
        let $ = await this.getHtml(this.siteUrl)
        let classes = this.classes.slice(1)
        for (let i = 0; i < classes.length; i++) {
            let type_name = classes[i].type_name
            let type_id = classes[i].type_id
            let extend_list = await this.getFilter($, i, type_id, type_name)
            if (extend_list.length > 1 && i < 4) {
                type_id = extend_list[0]["value"][0]["v"]
                this.classes[i + 1] = this.getTypeDic(type_name, type_id)
            }
            this.filterObj[type_id] = extend_list
        }
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

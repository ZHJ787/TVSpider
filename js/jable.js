/*
* @File     : jable.js
* @Author   : jade / ZHJ787
* @Desc     : 用 curl-impersonate 绕过 Cloudflare (PC) + https.request 降级 (iOS)
*/
import {_, load} from '../lib/cat.js';
import {VodDetail, VodShort} from "../lib/vod.js"
import * as Utils from "../lib/utils.js";
import {Spider} from "./spider.js";
import https from "https";
import zlib from "zlib";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";


class JableTVSpider extends Spider {
    constructor() {
        super();
        this.siteUrl = "https://fs1.app"
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
            "User-Agent": "PostmanRuntime/7.37.3",
            "Postman-Token": "c2602692-1a05-4bb0-93cd-270afad97e87",
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
        // PostmanRuntime UA + Postman-Token 是绕过 jable.tv Cloudflare 挑战的关键组合
        // 必须带 Accept 和 Accept-Encoding, 否则有些请求会返回空响应
        let header = {
            "User-Agent": "PostmanRuntime/7.36.3",
                        "Postman-Token": "33290483-3c8d-413f-a160-0d3aea9e6f95",
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache"
        };
        return header;
    }

    async getHtml(url = this.siteUrl, proxy = false, headers = this.getHeader()) {
        // 优先级 1: curl-impersonate (PC, Chrome TLS 指纹, 100% 绕过 CF)
        try {
            let html = await this._curlImpersonateGet(url, headers);
            if (html && html.length > 1000 && html.indexOf("Just a moment") < 0) {
                return load(html);
            }
        } catch (e) {
            // curl-impersonate 不可用 (iOS 或二进制下载失败), 降级
        }
        
        // 优先级 2: https.request (fs1.app, CF 只检查 UA)
        if (typeof https !== 'undefined' && https && typeof https.request === 'function') {
            const maxRetries = 2;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    let html = await this._httpsGet(url, headers);
                    if (html && html.length > 1000 && html.indexOf("Just a moment") < 0) {
                        return load(html);
                    }
                    await Utils.sleep(1);
                } catch (e) {
                    await Utils.sleep(1);
                }
            }
        }
        
        // 优先级 3: cat.js req
        for (let i = 0; i < 2; i++) {
            let $ = await super.getHtml(url, true, headers);
            if ($ === null || $ === undefined) {
                await Utils.sleep(1);
                continue;
            }
            return $;
        }
        return null;
    }

    // curl-impersonate 二进制调用 (和 Python curl_cffi 底层一样)
    // 首次使用时从 GitHub Release 下载二进制, 后续直接调用
    async _curlImpersonateGet(url, headers) {
        const tmpDir = os.tmpdir();
        const binPath = path.join(tmpDir, 'curl-impersonate-chrome');
        
        // 下载二进制 (如果不存在)
        if (!fs.existsSync(binPath)) {
            const downloadUrl = 'https://github.com/ZHJ787/TVSpider/releases/download/v1/curl-impersonate-chrome-linux-x86';
            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(binPath);
                https.get(downloadUrl, (res) => {
                    if (res.statusCode === 302 || res.statusCode === 301) {
                        https.get(res.headers.location, (res2) => {
                            res2.pipe(file);
                            file.on('finish', () => { file.close(); fs.chmodSync(binPath, 0o755); resolve(); });
                        }).on('error', reject);
                    } else if (res.statusCode === 200) {
                        res.pipe(file);
                        file.on('finish', () => { file.close(); fs.chmodSync(binPath, 0o755); resolve(); });
                    } else {
                        reject(new Error('download failed: ' + res.statusCode));
                    }
                }).on('error', reject);
            });
        }
        
        // 调用 curl-impersonate (Chrome TLS 指纹 + PostmanRuntime UA)
        const args = [
            '-s', '-o', '-',
            '-w', '\n__HTTP_CODE__:%{http_code}',
            '--compressed', '--max-time', '15'
        ];
        const reqHeaders = headers || {};
        const keys = Object.keys(reqHeaders);
        for (let i = 0; i < keys.length; i++) {
            args.push('-H', keys[i] + ': ' + reqHeaders[keys[i]]);
        }
        args.push(url);
        
        const r = spawnSync(binPath, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        if (r.error) {
            throw new Error('spawn failed: ' + r.error.message);
        }
        const out = r.stdout || '';
        const idx = out.lastIndexOf('__HTTP_CODE__:');
        const code = idx > -1 ? out.slice(idx + 14).trim() : 'N/A';
        const body = idx > -1 ? out.slice(0, idx) : out;
        if (code !== '200') {
            throw new Error('HTTP ' + code);
        }
        return body;
    }

    async _httpsGet(url, headers) {
        return new Promise((resolve, reject) => {
            const reqHeaders = {...(headers || {}), 'Accept-Encoding': 'identity'};
            const req = https.request(url, {
                method: 'GET',
                headers: reqHeaders
            }, (res) => {
                let chunks = [];
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
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(10000, () => req.destroy(new Error('timeout')));
            req.end();
        });
    }

    // 硬编码分类 (不爬 fs1.app, 避免客户端超时)
    static CATEGORIES = [
        { type_id: "https://fs1.app/categories/bdsm/", type_name: "📚 主奴調教" },
        { type_id: "https://fs1.app/categories/sex-only/", type_name: "🔞 直接開啪" },
        { type_id: "https://fs1.app/categories/chinese-subtitle/", type_name: "📝 中文字幕" },
        { type_id: "https://fs1.app/categories/insult/", type_name: "😤 凌辱快感" },
        { type_id: "https://fs1.app/categories/uniform/", type_name: "👔 制服誘惑" },
        { type_id: "https://fs1.app/categories/roleplay/", type_name: "🎭 角色劇情" },
        { type_id: "https://fs1.app/categories/private-cam/", type_name: "📷 盜攝偷拍" },
        { type_id: "https://fs1.app/categories/uncensored/", type_name: "🔓 無碼解放" },
        { type_id: "https://fs1.app/categories/pov/", type_name: "👁 男友視角" },
        { type_id: "https://fs1.app/categories/groupsex/", type_name: "👥 多P群交" },
        { type_id: "https://fs1.app/categories/pantyhose/", type_name: "👠 絲襪美腿" },
        { type_id: "https://fs1.app/categories/lesbian/", type_name: "👩女同歡愉" },
        { type_id: "https://fs1.app/latest-updates/", type_name: "💡 新片優先" },
        { type_id: "https://fs1.app/hot/", type_name: "🔥 熱度優先" },
    ];

    async setClasses() {
        this.classes = [];
        this.classes.push(this.getTypeDic("最近更新", "最近更新"));
        for (const cat of JableTVSpider.CATEGORIES) {
            this.classes.push(this.getTypeDic(cat.type_name, cat.type_id));
        }
    }

    async setFilterObj() {
        this.filterObj = {};
        for (const cat of JableTVSpider.CATEGORIES) {
            this.filterObj[cat.type_id] = [{
                name: "排序", key: "sort",
                value: [
                    { n: "近期最佳", v: "post_date_and_popularity" },
                    { n: "最近更新", v: "post_date" },
                    { n: "最多觀看", v: "video_viewed" },
                    { n: "最高收藏", v: "most_favourited" },
                ]
            }];
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
                // if (this.catOpenStatus) {
                //     vodShort.vod_pic = this.jsBase + Utils.base64Encode(vod_pic)
                // } else {
                //     vodShort.vod_pic = vod_pic
                // }
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
        // if (this.catOpenStatus) {
        //     vodDetail.vod_pic = this.jsBase + Utils.base64Encode(vod_pic)
        // } else {
        //     vodDetail.vod_pic = vod_pic
        // }
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
            this.homeVodList = [{
                vod_id: "diag",
                vod_name: "❌getHtml失败 站点:" + this.siteUrl,
                vod_pic: "",
                vod_remarks: "cat.js req 可能无法访问 fs1.app"
            }]
            return
        }
        try {
            this.homeVodList = await this.parseVodShortListFromDoc($)
        } catch (e) {
            this.homeVodList = [{
                vod_id: "diag",
                vod_name: "❌解析失败:" + e.message,
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
        let extend_type = (extend["type"] ?? tid).replace(/\/$/, "")
        let sort_by = extend["sort"] ?? "video_viewed"
        this.limit = 24
        let cateUrl;
        this.total = 0
        this.count = 0
        if (tid.indexOf("latest-updates") > 1) {
            cateUrl = `https://fs1.app/latest-updates/?mode=async&function=get_block&block_id=list_videos_latest_videos_list&sort_by=post_date&from=${pg}&_=1709730132217`
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
        this.vodList = await this.parseVodShortListFromDocByCategory($)
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
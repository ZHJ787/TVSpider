/*
* @File     : jable.js
* @Author   : jade / ZHJ787
* @Date     : 2024/3/4 9:44
* @Email    : jadehh@1ive.com
* @Software : Samples
* @Desc     : 通过 omnibox 中转访问 jable.tv (omnibox 用 curl_cffi 绕过 Cloudflare)
*/
import {_, load} from '../lib/cat.js';
import {VodDetail, VodShort} from "../lib/vod.js"
import * as Utils from "../lib/utils.js";
import {Spider} from "./spider.js";

// omnibox 中转配置
const OMNIBOX_BASE = "https://omnibox.zzzhj.dpdns.org";
const OMNIBOX_SPIDER_ID = "2069033891347304448";
const OMNIBOX_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwYXNzd29yZF9oYXNoIjoiOTk3NDBlOGNmZjAwMDZkNiIsImV4cCI6MjA5Nzk3MjM4NywibmJmIjoxNzgyNjEyMzg3LCJpYXQiOjE3ODI2MTIzODd9.synOu7t4veExv0SxN0MaZhJyjbGOoFPECiQ91EtfmCs";

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
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br"
        };
    }

    // 通过 omnibox execute 接口调用 py 脚本
    // omnibox 服务器用 curl_cffi 绕过 Cloudflare, 100% 稳定
    async _omniboxExecute(method, params = {}) {
        const url = `${OMNIBOX_BASE}/api/spider-source/${OMNIBOX_SPIDER_ID}/execute`;
        const body = JSON.stringify({ method, params });
        
        // 优先用 Node.js 原生 https (避免 cat.js req 函数的 bug)
        if (typeof globalThis.require === 'function') {
            const https = globalThis.require('https');
            return new Promise((resolve, reject) => {
                const req = https.request(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OMNIBOX_TOKEN}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, (res) => {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => {
                        try {
                            const text = Buffer.concat(chunks).toString('utf8');
                            const json = JSON.parse(text);
                            if (json.code === 200 && json.success) {
                                resolve(json.data);
                            } else {
                                reject(new Error(`omnibox execute 失败: ${json.message}`));
                            }
                        } catch (e) {
                            reject(new Error(`omnibox 响应解析失败: ${e.message}`));
                        }
                    });
                });
                req.on('error', reject);
                req.setTimeout(30000, () => req.destroy(new Error('timeout')));
                req.write(body);
                req.end();
            });
        }
        
        // TVBox 环境: 用 cat.js 的 req 函数
        const resp = await req(url, {
            method: 'post',
            headers: {
                'Authorization': `Bearer ${OMNIBOX_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: body,
            timeout: 30000
        });
        if (resp.code === 200) {
            const json = JSON.parse(resp.content);
            if (json.code === 200 && json.success) {
                return json.data;
            }
        }
        throw new Error(`omnibox execute 失败: ${resp.code}`);
    }

    async setClasses() {
        // 通过 omnibox 拿 home 数据, 提取 class
        const data = await this._omniboxExecute('home', {});
        this.classes = data.class || [];
    }

    async setFilterObj() {
        // omnibox py 脚本没有返回 filters, 用空对象
        this.filterObj = {};
    }

    async setHomeVod() {
        const data = await this._omniboxExecute('home', {});
        this.homeVodList = (data.list || []).map(v => {
            const vs = new VodShort();
            vs.vod_id = v.vod_id;
            vs.vod_name = v.vod_name;
            vs.vod_pic = v.vod_pic;
            vs.vod_remarks = v.vod_remarks || "";
            return vs;
        });
    }

    async setCategory(tid, pg, filter, extend) {
        const data = await this._omniboxExecute('category', {
            type_id: tid,
            page: parseInt(pg) || 1
        });
        this.vodList = (data.list || []).map(v => {
            const vs = new VodShort();
            vs.vod_id = v.vod_id;
            vs.vod_name = v.vod_name;
            vs.vod_pic = v.vod_pic;
            vs.vod_remarks = v.vod_remarks || "";
            return vs;
        });
        this.page = parseInt(pg) || 1;
        this.count = data.pagecount || 999;
        this.limit = data.limit || 24;
        this.total = data.total || 9999;
    }

    async setDetail(id) {
        const data = await this._omniboxExecute('detail', { videoId: id });
        const v = (data.list || [])[0];
        if (!v) return;
        
        this.vodDetail = new VodDetail();
        this.vodDetail.vod_id = id;
        this.vodDetail.vod_name = v.vod_name;
        this.vodDetail.vod_pic = v.vod_pic;
        this.vodDetail.vod_year = v.vod_year || "";
        this.vodDetail.vod_content = v.vod_content || "";
        this.vodDetail.vod_actor = v.vod_actor || "";
        
        // 转换播放源格式
        // omnibox 返回: vod_play_sources: [{name, episodes: [{name, playId}]}]
        // cat.js 需要: vod_play_from = "源名1$$$源名2", vod_play_url = "集名1$播放地址1#集名2$播放地址2"
        if (v.vod_play_sources && v.vod_play_sources.length > 0) {
            const fromList = [];
            const urlList = [];
            for (const src of v.vod_play_sources) {
                fromList.push(src.name || "Jable");
                const episodes = (src.episodes || []).map(ep => `${ep.name}$${ep.playId}`);
                urlList.push(episodes.join('#'));
            }
            this.vodDetail.vod_play_from = fromList.join('$$$');
            this.vodDetail.vod_play_url = urlList.join('$$$');
        }
    }

    async setPlay(flag, id, flags) {
        // omnibox 的 play 方法返回播放地址和 headers
        try {
            const data = await this._omniboxExecute('play', { playId: id });
            if (data.urls && data.urls.length > 0) {
                this.playUrl = JSON.stringify({
                    parse: data.parse || 0,
                    url: data.urls[0].url,
                    header: data.header || {}
                });
            } else {
                this.playUrl = id;
            }
        } catch (e) {
            // 降级: 直接用 id 作为播放地址
            this.playUrl = id;
        }
    }

    async setSearch(wd, quick) {
        const data = await this._omniboxExecute('search', { keyword: wd, page: 1 });
        this.vodList = (data.list || []).map(v => {
            const vs = new VodShort();
            vs.vod_id = v.vod_id;
            vs.vod_name = v.vod_name;
            vs.vod_pic = v.vod_pic;
            vs.vod_remarks = v.vod_remarks || "";
            return vs;
        });
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

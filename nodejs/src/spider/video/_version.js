/*
* @File     : _version.js
* @Desc     : 版本检测虚拟站点 (自动生成，请勿手动修改)
*             name 字段含版本号，用于客户端确认当前加载的 dist/index.js 版本
*             点击该站点会返回空列表，不参与实际爬取
*/
class VersionSpider {
    constructor() {
        this.meta = { key: '_version', name: '🔧版本-diag5', type: 3 };
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

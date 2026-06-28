// TVBox 版本检测站点 (自动生成, 请勿手动修改)
// name 含版本号, 用于确认 TVBox 加载了哪个版本的配置
var version = 'v7';
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

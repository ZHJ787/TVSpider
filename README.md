# TVSpider

## 项目简介

本项目是一个 TVBox / CatVodOpen 的爬虫源项目，用于抓取和提供视频资源接口。

当前仅保留 **Jable** 爬虫源，后续可根据需求扩展其他源。

## 项目结构

```
TVSpider/
├── js/                     # 爬虫脚本目录
│   ├── jable.js           # JableTV 爬虫
│   └── spider.js          # 基础爬虫类
├── lib/                    # 公共库
├── nodejs/                 # Node.js 构建目录
 Opinion
│   ├── src/
│   │   ├── index.js       # 入口文件
│   │   ├── index.config.js # 配置文件
│   │   └── spider/        # 爬虫实现
│   └── dist/              # 构建输出目录
├── build.py               # 配置文件生成脚本
├── 18_tv_config.json      # TVBox 配置文件
├── 18_open_config.json    # CatOpen 配置文件
└── README.md
```

## 快速开始

### 1. 生成配置文件

```bash
# 生成 TVBox 和 CatOpen 配置文件
python build.py --key jable
```

### 2. 构建 Node.js 产物

```bash
cd nodejs
npm install
npm run build
```

构建完成后，产物位于 `nodejs/dist/` 目录：
- `index.js` / `index.js.md5` — 猫源主入口
- `index.config.js` / `index.config.js.md5` — 猫源配置

## 使用方式

### TVBox

将生成的 `18_tv_config.json` 配置到 TVBox 中即可使用。

### CatVodOpen

使用 `nodejs/dist/index.js.md5` 作为猫源接口地址。

## 开发说明

- 爬虫脚本位于 `js/` 目录，需继承 `spider.js` 中的基础类
- 新增爬虫后，运行 `build.py` 生成对应配置
- 修改 `nodejs/src/` 下的源码后，执行 `npm run build` 重新构建

## 免责声明

本项目仅供学习研究使用，不得用于商业用途。使用本项目的任何第三方硬件、软件所造成的后果由使用者自行承担。 
>
> [阿里Token获取](https://alist.nn.ci/zh/guide/drivers/aliyundrive.html)
>
> nodejs 部分只生成代码，需要手动build，区分18+

## 直播源生成
> 见[jadehh/LiveSpider](https://github.com/jadehh/LiveSpider)


## 遇到的问题
* 玩偶姐姐播放不了,需要切换VPN节点
* m3u8遇到跨域的问题可以尝试使用代理来进行加载，如果没有跨域使用代理会引起死循环
* 虎牙弹幕功能无法实现,现在并不支持WebSocket来监听弹幕
* SP360启用嗅探解析,CatVodOpen目前还不支持嗅探
* CatVodOpen Windows无法预览Jable和Doll图片,需要手动开启代理加载。
* TV影视暂不不支持哔哩哔哩DASH文件播放
* 老版本的CatVodOpen cfg参数类型为:string,TV参数类型为[object],所有需要区分,初始化的时候还是用this.cfgObj

## 特别说明
* 近期CatVodOpen更新移除了quickjs,导致无法使用,请尝试使用旧版本
* 或切换至nodejs目录下编译生成dist目录，dist目录发布到dist分支下
* main分支用于代码测试(不包含任何配置信息)，js分支发布支持quickjs爬虫配置信息，dist分支发布支持nodejs爬虫配置信息
* 所有的配置信息都通过Github Actions发布，通过创建tag来生成新的配置信息并自动发布
* fork仓库时去掉仅复制main分支的&#x2714;，这样就可以fork所有的分支了
  
## ✨ Star 数

[![Star History Chart](https://api.star-history.com/svg?repos=jadehh/TVSpider&type=Date)](https://star-history.com/#jadehh/TVSpider&Date)
---

## 飞机群

加入我们吧

<img src="./assets/image.png" alt="telegram" width="256" height="256" align="left" /> 
<br><br><br><br><br><br><br><br><br><br>

----

## 赞助

如果觉得此项目有用，可以考虑赞助我喝杯咖啡，感谢star❤

<img src="./resources/wechat.jpg" alt="微信" width="256" height="256" align="left" />
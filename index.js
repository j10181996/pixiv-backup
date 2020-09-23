const fs = require('fs');
const moment = require('moment');
const config = require('config');
const PixivAppApi = require("pixiv-app-api");
const PixivApi = require('pixiv-api-client');
const pixivImg = require('pixiv-img');

const pixiv = new PixivApi();
const appPixiv = new PixivAppApi();
const scanAll = config.get('scanAll');
let id, tags;

const checkPath = (path) => {
    let newPath = path;
    newPath = newPath.replace(/\</g, '＜');
    newPath = newPath.replace(/\>/g, '＞');
    newPath = newPath.replace(/\:/g, '：');
    newPath = newPath.replace(/\"/g, '＂');
    newPath = newPath.replace(/\|/g, '｜');
    newPath = newPath.replace(/\?/g, '？');
    newPath = newPath.replace(/\*/g, '＊');
    return newPath;
}

const autoClassify = async () => {
    let res = await appPixiv.userBookmarksIllust(id);
    let obj = {};
    while (true) {
        res.illusts.forEach(illust => {
            illust.tags.forEach(tag => {
                if (obj[tag.name]) {
                    ++obj[tag.name];
                }
                else {
                    obj[tag.name] = 1;
                }
            });
        });
        if (!res.nextUrl) {
            break;
        }
        res = await appPixiv.next();
    }
    const tags = Object.keys(obj);
    tags.sort((a, b) => obj[b] - obj[a]);
    return tags;
}

const novelBackup = async (tag, doSearch) => {
    try {
        let res;
        if (doSearch) {
            res = await appPixiv.searchNovel(tag);
        }
        else {
            res = await appPixiv.next();
        }
        const novels = res.novels;
        for (let i = 0; i < novels.length; ++i) {
            const novel = novels[i];
            if (novel.isBookmarked) {
                let path = `./novels/${tag}/${novel.id}-${novel.title.replace(/\//g, '／')}.txt`;
                path = checkPath(path);
                if (!fs.existsSync(path)) {
                    const res = await pixiv.novelText(novel.id);
                    fs.writeFileSync(path, res.novel_text.replace(/\n/g, '\n　　'));
                    console.log(path);
                }
                else {
                    continue;
                }
            }
        }
        if (!res.nextUrl) {
            return 'done';
        }
        const lastCreateDate = moment(novels[novels.length - 1].createDate).format('YYYY-MM-DD');
        return lastCreateDate;
    }
    catch (e) {
        if (e.response && (e.response.status === 403 || e.response.status === 400)) {
            console.log("Take a break!");
            return;
        }
        console.log(e);
        fs.appendFile('./log.txt', `${e}\n`, (e) => console.log(e));
    }
}

const illustBackup = async (doSearch) => {
    try {
        let res, upToDate = false;
        if (doSearch) {
            res = await appPixiv.userBookmarksIllust(id);
        }
        else {
            res = await appPixiv.next();
        }
        let illusts = res.illusts;

        for (let i = 0; i < illusts.length; ++i) {
            const illust = illusts[i];
            const tag = tags.find(a => illust.tags.findIndex(b => b.name.includes(a)) > -1);
            const tagDir = tag ? `./illusts/${tag.replace(/\//g, '／')}` : `./illusts`;
            if (!fs.existsSync(tagDir)) {
                fs.mkdirSync(tagDir);
            }
            if (illust.title) {
                if (illust.metaPages.length !== 0) {
                    let dir = `${tagDir}/${illust.id}-${illust.title.replace(/\//g, '／')}`;
                    dir = checkPath(dir);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir);
                        console.log(dir);
                    }
                    else {
                        upToDate = true;
                        continue;
                    }
                    for (let j = 0; j < illust.metaPages.length; ++j) {
                        const img = illust.metaPages[j];
                        const url = img.imageUrls.original;
                        const arr = url.split('\.');
                        const path = `${dir}/p${j}.${arr[arr.length - 1]}`;
                        await pixivImg(url, path);
                    }
                }
                else {
                    const url = illust.metaSinglePage.originalImageUrl;
                    const arr = url.split('\.');
                    let path = `${tagDir}/${illust.id}-${illust.title.replace(/\//g, '／')}.${arr[arr.length - 1]}`;
                    path = checkPath(path);
                    if (!fs.existsSync(path)) {
                        await pixivImg(url, path);
                        console.log(path);
                    }
                    else {
                        upToDate = true;
                        continue;
                    }
                }
            }
        }
        if ((upToDate && !scanAll) || !res.nextUrl) {
            return 'done';
        }
    }
    catch (e) {
        if (e.response && (e.response.status === 403 || e.response.status === 400)) {
            console.log("Take a break!");
            return;
        }
        console.log(e);
        fs.appendFile('./log.txt', `${e}\n`, (e) => console.log(e));
    }
}

const app = async () => {
    const username = config.get('account');
    const password = config.get('password');
    const userTags = config.get('tags');
    const lastBackup = config.get('lastBackup');
    const novelCycle = config.get('novelCycle');
    const doNovelBackup = config.get('doNovelBackup');
    try {
        id = (await appPixiv.login(username, password)).user.id;
        await pixiv.login(username, password);
    }
    catch (e) {
        console.log("Login Failed!");
    }

    if (!fs.existsSync('./novels')) {
        fs.mkdirSync('./novels');
    }
    if (!fs.existsSync('./illusts')) {
        fs.mkdirSync('./illusts');
    }
    userTags.forEach(tag => {
        if (!fs.existsSync(`./novels/${tag}`)) {
            fs.mkdirSync(`./novels/${tag}`);
        }
    });
    userTags.forEach(tag => {
        if (!fs.existsSync(`./illusts/${tag}`)) {
            fs.mkdirSync(`./illusts/${tag}`);
        }
    });
    const autoTags = await autoClassify();
    const unnecessaryTags = config.get('unnecessaryTags');
    const unnecessaryWords = ["users入り", "なにこれ", "目から", "あなたが", "腐", "これはいい", "かわいい", "素敵"];
    tags = userTags.concat(autoTags).filter(item => unnecessaryTags.indexOf(item) === -1).filter(item => unnecessaryWords.every(word => !item.includes(word)));
    tags = tags.filter((item, i) => tags.indexOf(item) === i);
    console.log(tags);

    let tagIndex = 0;
    let doSearch = true;
    if (doNovelBackup && tags.length > 0) {
        const novelInterval = setInterval(async () => {
            const res = await novelBackup(tags[tagIndex], doSearch);
            doSearch = false;
            if (res === 'done' || (!scanAll && moment(res).isBefore(lastBackup))) {
                ++tagIndex;
                doSearch = true;
                if (tagIndex === tags.length) {
                    console.log('Done Novel Backup!');
                    clearInterval(novelInterval);
                    try {
                        const json = fs.readFileSync('./config/default.json');
                        const obj = JSON.parse(json);
                        obj.lastBackup = moment().format('YYYY-MM-DD');
                        fs.writeFileSync('./config/default.json', JSON.stringify(obj));
                    }
                    catch (e) {
                        console.log(e);
                    }
                    while (true) {
                        const res = await illustBackup(doSearch);
                        doSearch = false;
                        if (res === 'done') {
                            console.log('Done Illust Backup!');
                            break;
                        }
                    }
                }
            }
        }, novelCycle);
    }
    else {
        while (true) {
            const res = await illustBackup(doSearch);
            doSearch = false;
            if (res === 'done') {
                console.log('Done Illust Backup!');
                break;
            }
        }
    }
}

app();
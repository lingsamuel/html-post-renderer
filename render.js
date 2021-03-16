const puppeteer = require('puppeteer');
const chalk = require('chalk')
const fs = require('fs');
const util = require('util');
const path = require('path');

const jquery = require("jquery")
const jsdom = require("jsdom")
const { JSDOM } = jsdom;

async function ssr(browser, url, replaceResource) {
    const page = await browser.newPage();
    page
        // .on('request', async (interceptedRequest) => {
        //     const url = interceptedRequest.url();
        //     for (k of replaceResource.keys()) {
        //         if (url.includes(k)) {
        //             console.log(`Replace ${url} to ${replaceResource[k]}`)
        //             await page.addScriptTag({
        //                 // attr: data-stage=prerender
        //                 path: replaceResource[k],
        //             })
        //             interceptedRequest.abort()
        //             return;
        //         }
        //     }

        //     interceptedRequest.continue()
        // })
        .on('console', message => {
            const type = message.type().substr(0, 3).toUpperCase()
            const colors = {
                LOG: text => text,
                ERR: chalk.red,
                WAR: chalk.yellow,
                INF: chalk.cyan
            }
            const color = colors[type] || chalk.blue
            console.log(color(`${type} ${message.text()}`))
        })
        .on('pageerror', ({ message }) => console.log(chalk.red(message)))
        .on('response', response =>
            console.log(chalk.green(`${response.status()} ${response.url()}`)))
        .on('requestfailed', request =>
            console.log(chalk.magenta(`${request.failure().errorText} ${request.url()}`)));

    await page.goto(url, { waitUntil: 'networkidle0' });
    let html = await page.content();

    let dom = new JSDOM(html);
    let $ = jquery(dom.window);

    // 移除预渲染脚本
    $('[data-stage="prerender"]').each((i, el) => {
        el.remove();
    });

    // 如果没有 katex，移除 katex css
    if ($('.katex').length === 0) {
        $('[data-dep="katex"]').each((i, el) => {
            el.remove();
        });
    }

    // 如果没有 figure 元素，移除 photoswipe
    if ($('figure').length === 0) {
        $('.pswp').each((i, el) => {
            el.remove();
        });
        $('[data-dep="photoswipe"]').each((i, el) => {
            el.remove();
        });
    }

    html = dom.serialize();
    await page.close();
    return html;
}

async function WriteFile(p, text) {
    const dir = path.dirname(p);
    fs.mkdirSync(dir, {
        recursive: true,
    });

    return await util.promisify(fs.writeFile)(p, text);
}

const { resolve } = require('path');
const { readdir, stat } = require('fs').promises;

function fileUrl(str) {
    if (typeof str !== 'string') {
        throw new Error('Expected a string');
    }

    var pathName = path.resolve(str).replace(/\\/g, '/');

    // Windows drive letter must be prefixed with a slash
    if (pathName[0] !== '/') {
        pathName = '/' + pathName;
    }

    return encodeURI('file://' + pathName);
}

async function getFiles(dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const res = resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
    }));
    return Array.prototype.concat(...files);
}

async function main(hugoFolder, outputFolder) {
    // hugoFolder = 'C:\\lingsamuel.github.io';
    // outputFolder = 'C:\\lingsamuel.github.io\\rendered';

    const contentDir = path.join(hugoFolder, "content");

    const publicDir = path.join(hugoFolder, "public");
    console.log("Public dir: ", publicDir);

    function needToRender(file) {
        let filename = path.basename(file);

        let needRender = filename.endsWith(".html") &&
            !filename.startsWith(".") &&
            !file.includes("moirae") &&
            !filename.includes("google04685cabc7d739ca");

        const stat = fs.statSync(file);
        needRender = needRender && fs.existsSync(file) && stat.size > 1000;
        if (!needRender) {
            console.log(`Ignore ${file} (size: ${stat.size})`);
        }
        return needRender;
    }
    const files = (await getFiles(publicDir));

    let validFiles = [];
    let directCopy = [];
    files.forEach(file => {
        if (needToRender(file)) {
            validFiles.push(file);
        } else {
            directCopy.push(file);
        }
    });

    for (const file of directCopy) {
        let output = path.join(outputFolder, path.relative(publicDir, file));
        console.log(`Copying ${file} -> ${output}`);
        const dir = path.dirname(output);
        fs.mkdirSync(dir, {
            recursive: true,
        });
        fs.copyFileSync(file, output);
    }

    const browser = await puppeteer.launch({ headless: true });

    let promises = [];
    for (const file of validFiles) {
        let output = path.join(outputFolder, path.relative(publicDir, file));
        console.log(`PreRendering ${file} -> ${output}`)
        let dom = await ssr(browser, fileUrl(file))
        promises.push(WriteFile(output, dom));
    }
    await Promise.all(promises);
    console.log("finished");
    await browser.close();
}

// node ./src/render.js path_to_hugo_project path_to_output_dir
main(process.argv[2], process.argv[3])

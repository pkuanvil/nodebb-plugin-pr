'use strict';

const https = require('https')
const nconf = require.main.require('nconf')

const HCAPTCHA_SECRET_KEY = nconf.get('hcaptcha:secretkey')
const HCAPTCHA_SITE_KEY = nconf.get('hcaptcha:sitekey')
const HCAPTCHA_HOST = "hcaptcha.com"
const HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify"

const hcaptcha = module.exports
const relative_path = nconf.get('relative_path')
const captcha_path = `${relative_path}/captcha`
const home_path = relative_path + '/'

hcaptcha.needCaptcha = async (req, res, next) => {
        const isSpider = req.isSpider()
        if (!req.user && !req.session.captcha && !isSpider) {
                if (req.originalUrl !== captcha_path) {
                        req.session.returnTo = req.originalUrl
                        return res.redirect(captcha_path)
                }
        }
        next()
}

const setData = (error) => {
        const data = {}
        data.sitekey = HCAPTCHA_SITE_KEY
        if (error) {
                data.error = error
        }
        return data
}

hcaptcha.get = async function (req, res, next) {
        res.render('hcaptcha', setData());
};

// Modified from https://github.com/vastus/node-hcaptcha/blob/master/index.js
hcaptcha.sendResponse = (req) => {
        return new Promise(function (resolve, reject) {
                const token = req.body?.['h-captcha-response'] || ""
                if (!token) {
                        reject(new Error("No response for captcha"))
                }
                const payload = { secret: HCAPTCHA_SECRET_KEY, response: token };
                const data = JSON.stringify(payload);
                const options = {
                        host: HCAPTCHA_HOST,
                        path: HCAPTCHA_VERIFY_URL,
                        method: 'POST',
                        headers: {
                                'content-type': 'application/json',
                                'content-length': Buffer.byteLength(data),
                        },
                };

                const h_request = https.request(options, (response) => {
                        response.setEncoding('utf8');

                        let buffer = '';

                        response
                                .on('error', reject)
                                .on('data', (chunk) => buffer += chunk)
                                .on('end', () => {
                                        try {
                                                const json = JSON.parse(buffer);
                                                resolve(json);
                                        } catch (error) {
                                                reject(error);
                                        }
                                });
                });

                h_request.on('error', reject);
                h_request.write(data);
                h_request.end();
        });
}

hcaptcha.post = async (req, res) => {
        try {
                await hcaptcha.sendResponse(req)
        } catch (e) {
                return res.render('hcaptcha', setData(e.message))
        }
        req.session.captcha = true
        const return_url = req.session.returnTo || home_path
        res.redirect(return_url)
}

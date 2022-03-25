import got from 'got';
import $ from 'cash-dom';
import jsdom from 'jsdom';

async function test() {
    const {body} = await got('https://machinesciences.adionsystems.com/procnc/');
    const dom = new jsdom.JSDOM(body);

    $(dom.window.document).find('p').each(function() {
        console.log($(this));
    })
}

test();
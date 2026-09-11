import { load } from 'cheerio';

const target = process.argv[2] ?? 'https://anikototv.to/filter';
const response = await fetch(target, {
  headers: {
    accept: 'text/html',
    'user-agent': 'Mozilla/5.0 (compatible; SolAnimeSchoolProject/0.1)',
  },
  signal: AbortSignal.timeout(20_000),
});
const text = await response.text();
const $ = load(text);
console.log(
  JSON.stringify(
    {
      status: response.status,
      title: $('title').text().trim(),
      watchLinks: $('a[href*="/watch/"]')
        .slice(0, 8)
        .map((_index, item) => ({
          href: $(item).attr('href'),
          text: $(item).text().replace(/\s+/g, ' ').trim().slice(0, 120),
          ancestors: $(item)
            .parents()
            .slice(0, 5)
            .map((_i, parent) => `${parent.tagName}.${$(parent).attr('class') ?? ''}`)
            .get(),
          html: $.html($(item).parent()).slice(0, 1500),
        }))
        .get(),
      pager: $('a[href*="page="]')
        .slice(-8)
        .map((_index, item) => ({
          href: $(item).attr('href'),
          text: $(item).text().replace(/\s+/g, ' ').trim(),
        }))
        .get(),
      watchMain: $('#watch-main')
        .map((_index, item) => ({
          attrs: item.attribs,
          text: $(item).text().replace(/\s+/g, ' ').trim().slice(0, 800),
        }))
        .get(),
      headings: $('h1,h2,.title,.name,.synopsis,.description')
        .slice(0, 30)
        .map((_index, item) => ({
          tag: item.tagName,
          class: $(item).attr('class'),
          text: $(item).text().replace(/\s+/g, ' ').trim().slice(0, 500),
        }))
        .get(),
      metadata: $('[class*="meta"],.detail,.info')
        .slice(0, 20)
        .map((_index, item) => ({
          tag: item.tagName,
          class: $(item).attr('class'),
          text: $(item).text().replace(/\s+/g, ' ').trim().slice(0, 500),
        }))
        .get(),
      titleFields: $('#watch-main .bmeta .meta > *')
        .map((_index, item) => ({
          tag: item.tagName,
          class: $(item).attr('class'),
          text: $(item).text().replace(/\s+/g, ' ').trim(),
          html: $.html(item).slice(0, 1000),
        }))
        .get(),
      titleImages: $('#watch-main img')
        .slice(0, 5)
        .map((_index, item) => ({
          src: $(item).attr('src'),
          alt: $(item).attr('alt'),
          class: $(item).attr('class'),
        }))
        .get(),
    },
    null,
    2,
  ),
);

#!/usr/bin/env python3
"""Print the evidence needed to check a person's Wikidata ID and portrait.

Read-only: it writes nothing. Run from the repository root:

    python3 -I .claude/skills/verify-identity/lookup.py <person-id> [<person-id> ...]
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Generic on purpose: no personal details go to outside services.
UA = {'User-Agent': 'identity-check/1.0'}
# employer, occupation, works, website, X, Instagram, YouTube, IMDb, born, image
PROPS = {'P106': 'occupation', 'P108': 'employer', 'P800': 'works', 'P569': 'born',
         'P856': 'site', 'P2002': 'x', 'P2003': 'instagram', 'P2397': 'youtube',
         'P345': 'imdb', 'P18': 'image'}
LABELS = {}


def get(base, **params):
    url = base + ('?' + urllib.parse.urlencode(params) if params else '')
    for attempt in range(5):
        time.sleep(1.5)
        try:
            request = urllib.request.Request(url, headers=UA)
            return json.load(urllib.request.urlopen(request, timeout=30))
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            time.sleep(min(int(error.headers.get('Retry-After') or 30), 60))


def clean(value):
    return re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', str(value))).strip()[:300]


def label(qid):
    if qid not in LABELS:
        entity = get('https://www.wikidata.org/w/api.php', action='wbgetentities',
                     ids=qid, props='labels', languages='en', format='json')['entities'][qid]
        LABELS[qid] = entity.get('labels', {}).get('en', {}).get('value', qid)
    return LABELS[qid]


def entity(qid):
    data = get(f'https://www.wikidata.org/wiki/Special:EntityData/{qid}.json')
    found = next(iter(data['entities'].values()))
    print(f"  {qid}: {found.get('labels', {}).get('en', {}).get('value')} | "
          f"{found.get('descriptions', {}).get('en', {}).get('value')}")
    for prop, name in PROPS.items():
        values = []
        for claim in found.get('claims', {}).get(prop, [])[:4]:
            value = claim['mainsnak'].get('datavalue', {}).get('value')
            if isinstance(value, dict):
                value = label(value['id']) if 'id' in value else value.get('time', '')[1:11]
            values.append(value)
        if values:
            print(f'    {name}: {values}')
    for wiki, link in found.get('sitelinks', {}).items():
        if wiki.endswith('wiki'):
            print(f"    {wiki}: {link['title']}")


def caption(source):
    if 'flickr.com' in source:
        data = get('https://www.flickr.com/services/oembed/', format='json', url=source)
        print(f"  flickr title: {data.get('title')} (by {data.get('author_name')})")
        return
    page_id = re.search(r'curid=(\d+)', source)
    if page_id:
        query = {'pageids': page_id.group(1)}
    elif 'commons.wikimedia.org/wiki/' in source:
        query = {'titles': urllib.parse.unquote(source.split('/wiki/')[1])}
    else:
        print('  not a Commons or Flickr source; open it and read the caption')
        return
    page = get('https://commons.wikimedia.org/w/api.php', action='query', prop='imageinfo',
               iiprop='extmetadata', format='json', formatversion=2, **query)['query']['pages'][0]
    meta = page.get('imageinfo', [{}])[0].get('extmetadata', {})
    print(f"  file: {page.get('title')}")
    for key in ('ImageDescription', 'DateTimeOriginal', 'Categories'):
        if key in meta:
            print(f"    {key}: {clean(meta[key]['value'])}")


def field(text, pattern):
    match = re.search(pattern, text, re.M)
    return match.group(1) if match else None


for person in sys.argv[1:]:
    print(f'\n=== {person}')
    try:
        with open(f'data/people/{person}.yml', encoding='utf-8') as handle:
            text = handle.read()
        name = field(text, r'^canonical_name: (.*)$').strip('"\'')
        qid = field(text, r'^wikidata_qid: (Q\d+)')
        block = field(text, r'^image:\n((?:  .*\n)+)') or ''
        print(f'  name: {name}')
        print('  shows:', sorted(set(re.findall(r'^  - show: (\S+)', text, re.M))))
        print('  cited:', sorted(set(re.findall(r'url: (https?://\S+)',
                                                text.replace(block, '')))))
        if qid:
            entity(qid)
        source = field(block, r'^  source: (\S+)')
        if source:
            caption(source)
            print(f"  open: {field(block, r'^  url: (\S+)')}")
        hits = get('https://www.wikidata.org/w/api.php', action='wbsearchentities',
                   search=name, language='en', type='item', limit=10, format='json')
        print('  same name on Wikidata:')
        for hit in hits.get('search', []):
            print(f"    {hit['id']}: {hit.get('description')}")
    except (OSError, urllib.error.URLError, KeyError, AttributeError) as error:
        print(f'  lookup failed: {error}')

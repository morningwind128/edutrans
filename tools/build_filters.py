#!/usr/bin/env python3
# Build declarativeNetRequest rulesets from open filter lists.
# Usage: HTTPS_PROXY=http://127.0.0.1:17890 python3 tools/build_filters.py
import json
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'filters')
os.makedirs(OUT, exist_ok=True)

ADS_CAP = 14000
ADULT_CAP = 8000

ADS_SOURCES = [
    'https://easylist-downloads.adblockplus.org/easylistchina.txt',
    'https://easylist-downloads.adblockplus.org/easylist.txt',
]
ADULT_SOURCES = [
    'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling-porn/hosts',
]

ALLOWED_RES = {'script', 'image', 'subdocument', 'xmlhttprequest',
               'ping', 'media', 'font', 'websocket', 'other'}
RES_MAP = {'subdocument': 'sub_frame'}
DEFAULT_TYPES = ['script', 'image', 'xmlhttprequest', 'sub_frame',
                 'media', 'ping', 'websocket', 'other']
BAD_OPTS = {'redirect', 'replace', 'csp', 'popup', 'ghide', 'elemhide',
            'elem', 'sitekey', 'document', 'webrtc', 'generichide'}


def fetch(url):
    req = urllib.request.Request(
        url, headers={'User-Agent': 'edutrans-build/0.2'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read().decode('utf-8', 'replace')


def convert_abp(line):
    if '$' in line:
        raw, opts = line.split('$', 1)
    else:
        raw, opts = line, ''
    resource_types = []
    domain_type = None
    initiator_domains = None
    for o in [x.strip() for x in opts.split(',') if x.strip()]:
        if o in BAD_OPTS or o.lstrip('~') in BAD_OPTS:
            return None
        if o == 'third-party':
            domain_type = 'thirdParty'
        elif o == '~third-party':
            domain_type = 'firstParty'
        elif o.startswith('domain='):
            doms = [d for d in o[7:].split('|')
                    if d and not d.startswith('~')]
            if doms:
                initiator_domains = doms
        elif o in ALLOWED_RES:
            resource_types.append(RES_MAP.get(o, o))
        else:
            return None
    cond = {'urlFilter': raw, 'isUrlFilterCaseSensitive': False,
            'resourceTypes': resource_types or list(DEFAULT_TYPES)}
    if domain_type:
        cond['domainType'] = domain_type
    if initiator_domains:
        cond['initiatorDomains'] = initiator_domains
    return {'condition': cond, 'action': {'type': 'block'}, 'priority': 1}


def build_ads():
    rules = []
    seen = set()
    for url in ADS_SOURCES:
        try:
            text = fetch(url)
        except Exception as e:
            print('WARN fetch failed:', url, e)
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith(('!', '#', '[', '@@')):
                continue
            if not line.startswith('||') or '^' not in line:
                continue
            if line in seen:
                continue
            rule = convert_abp(line)
            if not rule:
                continue
            seen.add(line)
            rules.append(rule)
            if len(rules) >= ADS_CAP:
                return rules
    return rules


def build_adult():
    rules = []
    seen = set()
    for url in ADULT_SOURCES:
        try:
            text = fetch(url)
        except Exception as e:
            print('WARN fetch failed:', url, e)
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            dom = parts[1].strip().lower()
            if not dom or '://' in dom or dom in seen:
                continue
            if dom in ('localhost', 'localhost.localdomain'):
                continue
            if dom.endswith('.local') or dom == '0.0.0.0':
                continue
            seen.add(dom)
            rules.append({
                'condition': {
                    'urlFilter': '||' + dom + '^',
                    'isUrlFilterCaseSensitive': False,
                    'resourceTypes': ['main_frame', 'sub_frame']
                },
                'action': {'type': 'block'},
                'priority': 1
            })
            if len(rules) >= ADULT_CAP:
                return rules
    return rules


def write_rules(name, rules):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(rules, f, ensure_ascii=False, separators=(',', ':'))
    print(name, len(rules), 'rules')


def main():
    ads = build_ads()
    adult = build_adult()
    if not ads or not adult:
        print('ERROR: empty ruleset, aborting')
        sys.exit(1)
    write_rules('rules_ads.json', ads)
    write_rules('rules_adult.json', adult)


if __name__ == '__main__':
    main()

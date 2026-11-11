#!/usr/bin/env python3
"""Read the current page's actual controls for the worker build; no runtime DOM."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path

class Controls(HTMLParser):
    def __init__(self):
        super().__init__()
        self.controls = {}
        self.select = None
        self.option = None
    def handle_starttag(self, tag, attrs):
        row = dict(attrs)
        if tag in ('input', 'select') and row.get('id'):
            key = row['id']
            self.controls[key] = {**row, 'type': 'select-one' if tag == 'select' else row.get('type', 'text')}
            if tag == 'select':
                self.select = self.controls[key]
                self.select['options'] = []
        elif tag == 'option' and self.select is not None:
            self.option = {**row, 'text': ''}
    def handle_data(self, data):
        if self.option is not None:
            self.option['text'] += data
    def handle_endtag(self, tag):
        if tag == 'option' and self.select is not None and self.option is not None:
            value = self.option.get('value', self.option['text'])
            self.select['options'].append(value)
            if 'value' not in self.select or 'selected' in self.option:
                self.select['value'] = value
            self.option = None
        elif tag == 'select':
            self.select = None
            self.option = None

def read_definitions(page):
    source = Path(page).read_bytes()
    parser = Controls()
    parser.feed(source.decode())
    for row in parser.controls.values():
        if row['type'] == 'checkbox':
            row['checked'] = 'checked' in row
        elif row['type'] == 'range':
            row.setdefault('min', '0')
            row.setdefault('max', '100')
            row.setdefault('value', str((float(row['min']) + float(row['max'])) / 2))
        else:
            row.setdefault('value', '')
    return {'source': {'path': str(page), 'sha256': hashlib.sha256(source).hexdigest()}, 'controls': parser.controls}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--page', required=True)
    parser.add_argument('--out')
    args = parser.parse_args()
    encoded = json.dumps(read_definitions(args.page), separators=(',', ':')) + '\n'
    if args.out:
        target = Path(args.out)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(encoded)
    else:
        print(encoded, end='')

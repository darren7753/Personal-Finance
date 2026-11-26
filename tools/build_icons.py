import os, re, json, urllib.request, urllib.parse

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the project folder
out_dir = os.path.join(root, 'static', 'icons')
os.makedirs(out_dir, exist_ok=True)
BASE = 'https://raw.githubusercontent.com/microsoft/fluentui-system-icons/main/assets/'

ICONS = {  # key -> Fluent folder name
    'food': 'Food', 'cart': 'Cart', 'car': 'Vehicle Car', 'movies': 'Movies and TV', 'heart': 'Heart', 'bag': 'Shopping Bag',
    'heartpulse': 'Heart Pulse', 'home': 'Home', 'card': 'Wallet Credit Card', 'repeat': 'Arrow Repeat All', 'flash': 'Flash',
    'trending': 'Arrow Trending', 'box': 'Box', 'calday': 'Calendar Day', 'balloon': 'Balloon', 'savings': 'Savings',
    'receipt': 'Receipt', 'moneyhand': 'Money Hand', 'diamond': 'Diamond', 'calclock': 'Calendar Clock',
    'databar': 'Data Bar Vertical', 'calculator': 'Calculator', 'check': 'Checkmark Circle', 'warning': 'Warning',
    'chevright': 'Chevron Right', 'chevdown': 'Chevron Down', 'eye': 'Eye', 'eyeoff': 'Eye Off', 'signout': 'Sign Out',
}

def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read().decode('utf-8')
    except Exception:
        return None

table, missing = {}, []
for key, folder in ICONS.items():
    snake = folder.lower().replace(' ', '_')
    table[key] = {}
    for style in ('regular', 'filled'):
        svg = None
        for size in (24, 20, 16):
            url = BASE + urllib.parse.quote(folder) + '/SVG/ic_fluent_%s_%d_%s.svg' % (snake, size, style)
            svg = fetch(url)
            if svg:
                break
        if not svg:
            missing.append((key, style)); continue
        open(os.path.join(out_dir, '%s_%s.svg' % (snake, style)), 'w', encoding='utf-8').write(svg)
        vb = re.search(r'viewBox="([^"]+)"', svg).group(1)
        paths = re.findall(r'<path[^>]*\sd="([^"]+)"[^>]*/?>', svg)
        table[key][style] = {'vb': vb, 'd': paths}

lic = fetch('https://raw.githubusercontent.com/microsoft/fluentui-system-icons/main/LICENSE')
open(os.path.join(out_dir, 'LICENSE-fluent-icons.txt'), 'w', encoding='utf-8').write(
    'Fluent UI System Icons by Microsoft: https://github.com/microsoft/fluentui-system-icons\nLicensed under the MIT License.\n\n' + (lic or '(see the repository for the license text)'))

js = ['// Generated from Fluent UI System Icons (Microsoft, MIT license). Source files are in static/icons/.',
      'const FI = ' + json.dumps(table, separators=(',', ':')) + ';',
      "const icon = (name, style = 'regular', size = 18) => { const i = (FI[name] || {})[style]; if (!i) return '';",
      "  return `<svg class=\"fi\" width=\"${size}\" height=\"${size}\" viewBox=\"${i.vb}\" fill=\"currentColor\" aria-hidden=\"true\">${i.d.map(d => `<path d=\"${d}\"/>`).join('')}</svg>`; };", '']
open(os.path.join(root, 'static', 'js', 'icons.js'), 'w', encoding='utf-8').write('\n'.join(js))
print('icons:', len(table), '| missing:', missing, '| license saved:', bool(lic))

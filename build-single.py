"""Bundle src/ into one self-contained HTML file: dist/bmw-pong.html."""
import base64, os

root = os.path.dirname(os.path.abspath(__file__))
read = lambda *p: open(os.path.join(root, *p), encoding="utf-8").read()

logo = "data:image/svg+xml;base64," + base64.b64encode(
    open(os.path.join(root, "src", "assets", "logo.svg"), "rb").read()).decode()
html = read("src", "index.html")
brand = read("src", "brand.js").replace('logo: "assets/logo.svg"', f'logo: "{logo}"')
html = html.replace('<link rel="stylesheet" href="style.css" />', "<style>\n" + read("src", "style.css") + "\n</style>")
html = html.replace('src="assets/logo.svg"', f'src="{logo}"')
html = html.replace('<script src="brand.js"></script>', "<script>\n" + brand + "\n</script>")
html = html.replace('<script src="game.js"></script>', "<script>\n" + read("src", "game.js") + "\n</script>")
os.makedirs(os.path.join(root, "dist"), exist_ok=True)
open(os.path.join(root, "dist", "bmw-pong.html"), "w", encoding="utf-8").write(html)
print("wrote dist/bmw-pong.html")

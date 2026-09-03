from pathlib import Path

path=Path('index.html')
text=path.read_text(encoding='utf-8')
start_marker='\\n<!-- Apply the saved appearance before CSS/first paint.'
end_marker='</script>\\n'
start=text.find(start_marker)
if start < 0:
    raise SystemExit('literal-newline bootstrap start not found')
end=text.find(end_marker,start)
if end < 0:
    raise SystemExit('literal-newline bootstrap end not found')
end += len(end_marker)
block=text[start:end]
fixed=block.replace('\\n','\n')
text=text[:start]+fixed+text[end:]
path.write_text(text,encoding='utf-8')
print('normalized theme bootstrap newlines')

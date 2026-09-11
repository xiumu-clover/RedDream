from __future__ import annotations

import argparse
from pathlib import Path


def convert(source_dir: Path, output_dir: Path, *, force: bool) -> list[tuple[int, str, int]]:
    sources = sorted(
        (path for path in source_dir.glob("*.txt") if path.stem.isdigit()),
        key=lambda path: int(path.stem),
    )
    if not sources:
        raise SystemExit(f"未找到数字命名的 .txt 文件：{source_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    targets = [output_dir / f"{int(source.stem)}.md" for source in sources]
    existing = [target for target in targets if target.exists()]
    if existing and not force:
        names = ", ".join(target.name for target in existing)
        raise SystemExit(f"目标文件已存在（使用 --force 才可覆盖）：{names}")

    result: list[tuple[int, str, int]] = []
    for source, target in zip(sources, targets):
        text = source.read_bytes().decode("utf-8-sig")
        offset = 0
        title = ""
        body = ""
        for line in text.splitlines(keepends=True):
            if line.strip():
                title = line.strip()
                offset += len(line)
                body = text[offset:]
                break
            offset += len(line)
        if not title:
            raise SystemExit(f"空文件，无法生成 [T]：{source}")
        if not title.startswith("第") or "回" not in title:
            raise SystemExit(f"首个非空行不是明确回目：{source}\n{title}")

        newline = "\r\n" if "\r\n" in text else "\n"
        output = f"---{newline}order: {int(source.stem)}{newline}---{newline}"
        output += f"[T]{title}{newline}{body}"
        target.write_bytes(output.encode("utf-8"))
        if target.read_bytes() != output.encode("utf-8"):
            raise SystemExit(f"写入校验失败：{target}")
        result.append((int(source.stem), title, len(output.encode("utf-8"))))

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="将数字命名的章节 txt 转为带 order 和 [T] 的 Markdown")
    parser.add_argument("source_dir", type=Path, help="源 txt 文件夹")
    parser.add_argument("output_dir", type=Path, help="项目内 Markdown 输出文件夹")
    parser.add_argument("--force", action="store_true", help="允许覆盖已有目标文件")
    args = parser.parse_args()

    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    result = convert(source_dir, output_dir, force=args.force)
    print(f"已转换 {len(result)} 个文件：{output_dir}")
    for number, title, size in result:
        print(f"{number}.md\t{size} bytes\t{title}")


if __name__ == "__main__":
    main()

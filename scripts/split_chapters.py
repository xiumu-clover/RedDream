from __future__ import annotations

import argparse
import os
import re
import tempfile
from pathlib import Path


HEADING_RE = re.compile(
    r"^第([〇零一二两三四五六七八九十百]+)回[^\r\n]*",
    re.MULTILINE,
)

DIGITS = {
    "〇": 0,
    "零": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}


def parse_chinese_number(value: str) -> int:
    """Parse the chapter-number forms used by 红楼梦 headings."""
    total = 0
    remainder = value

    if "百" in remainder:
        hundreds, remainder = remainder.split("百", 1)
        total += DIGITS.get(hundreds, 1) * 100

    if "十" in remainder:
        tens, ones = remainder.split("十", 1)
        total += DIGITS.get(tens, 1) * 10
        if ones:
            total += DIGITS[ones]
    elif remainder:
        total += DIGITS[remainder]

    return total


def split_chapters(
    source: Path,
    output_dir: Path,
    start: int,
    end: int,
    *,
    force: bool,
    dry_run: bool,
) -> list[tuple[int, str, int]]:
    source_bytes = source.read_bytes()
    try:
        text = source_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SystemExit(f"源文件不是有效的 UTF-8：{source}\n{error}") from error

    matches: list[tuple[int, int, str]] = []
    for match in HEADING_RE.finditer(text):
        number = parse_chinese_number(match.group(1))
        if start <= number <= end:
            matches.append((number, match.start(), match.group(0)))

    expected = list(range(start, end + 1))
    first_match: dict[int, tuple[int, str]] = {}
    previous = start
    for number, offset, heading in matches:
        if number < previous:
            raise SystemExit(f"回次顺序倒退：{previous} 后出现了 {number}")
        previous = number
        first_match.setdefault(number, (offset, heading))

    missing = [number for number in expected if number not in first_match]
    if missing:
        raise SystemExit(f"缺少回次：{', '.join(map(str, missing))}")

    first_offset = first_match[start][0]
    if text[:first_offset].strip():
        raise SystemExit(f"第 {start} 回标题前存在非空文本，拒绝丢弃")

    output_dir.mkdir(parents=True, exist_ok=True)
    targets = [output_dir / f"{number}.txt" for number in expected]
    existing = [target for target in targets if target.exists()]
    if existing and not force:
        names = ", ".join(target.name for target in existing)
        raise SystemExit(f"目标文件已存在（使用 --force 才可覆盖）：{names}")

    result: list[tuple[int, str, int]] = []
    for number in expected:
        begin, heading = first_match[number]
        finish = first_match[number + 1][0] if number < end else len(text)
        chapter_bytes = text[begin:finish].encode("utf-8")
        target = output_dir / f"{number}.txt"

        if not dry_run:
            temp_name: str | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    dir=output_dir,
                    prefix=f".{target.name}.",
                    suffix=".tmp",
                    delete=False,
                ) as temp_file:
                    temp_name = temp_file.name
                    temp_file.write(chapter_bytes)
                os.replace(temp_name, target)
            finally:
                if temp_name and os.path.exists(temp_name):
                    os.unlink(temp_name)

            if target.read_bytes() != chapter_bytes:
                raise SystemExit(f"写入校验失败：{target}")

        result.append((number, heading, len(chapter_bytes)))

    combined = b"".join(
        text[
            first_match[number][0] : (
                first_match[number + 1][0] if number < end else len(text)
            )
        ].encode("utf-8")
        for number in expected
    )
    if combined != source_bytes[first_offset:]:
        raise SystemExit("拆分结果无法无损拼回源文件")

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="按‘第…回’标题拆分合并的章节文本")
    parser.add_argument("source", type=Path, help="待拆分的 UTF-8 文本文件")
    parser.add_argument("--output-dir", type=Path, help="输出目录；默认与源文件相同")
    parser.add_argument("--start", type=int, default=28, help="起始回次，默认 28")
    parser.add_argument("--end", type=int, default=80, help="结束回次，默认 80")
    parser.add_argument("--force", action="store_true", help="允许覆盖已有目标文件")
    parser.add_argument("--dry-run", action="store_true", help="只检查和显示拆分结果")
    args = parser.parse_args()

    if args.start > args.end:
        parser.error("--start 不能大于 --end")

    source = args.source.resolve()
    output_dir = (args.output_dir or source.parent).resolve()
    result = split_chapters(
        source,
        output_dir,
        args.start,
        args.end,
        force=args.force,
        dry_run=args.dry_run,
    )

    mode = "计划生成" if args.dry_run else "已生成"
    print(f"{mode} {len(result)} 个文件：{output_dir}")
    for number, heading, size in result:
        print(f"{number}.txt\t{size} bytes\t{heading}")


if __name__ == "__main__":
    main()

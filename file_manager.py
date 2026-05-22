import argparse
import os
import sys

def read_file(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            print(f.read())
    except Exception as e:
        print(f"Error reading file: {e}", file=sys.stderr)
        sys.exit(1)

def write_file(path, content):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Successfully written to {path}")
    except Exception as e:
        print(f"Error writing file: {e}", file=sys.stderr)
        sys.exit(1)

def replace_in_file(path, old_text, new_text):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()

        if old_text not in content:
            print(f"Error: Old text not found in file {path}", file=sys.stderr)
            sys.exit(1)

        new_content = content.replace(old_text, new_text)

        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Successfully replaced text in {path}")
    except Exception as e:
        print(f"Error replacing text: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Windows-safe File Manager for AI Agent")
    parser.add_argument("--read", help="Path to file to read")
    parser.add_argument("--write", nargs=2, metavar=('path', 'content'), help="Path and content to write")
    parser.add_argument("--replace", nargs=3, metavar=('path', 'old', 'new'), help="Path, old text, and new text")

    args = parser.parse_args()

    if args.read:
        read_file(args.read)
    elif args.write:
        write_file(args.write[0], args.write[1])
    elif args.replace:
        replace_in_file(args.replace[0], args.replace[1], args.replace[2])
    else:
        parser.print_help()

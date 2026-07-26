/**
 * Online compiler language matrix. Each entry maps to a Docker image (pulled once,
 * cached thereafter) plus the filename and shell command used to compile/run the
 * submitted source inside a fresh, network-isolated, resource-capped container.
 *
 * Picking images/commands that don't need network access at run time (no `npm install`,
 * `go get`, etc.) keeps this safe to run with NetworkMode: 'none'.
 */
const LANGUAGES = {
  python: {
    label: 'Python 3',
    image: 'python:3.12-slim',
    filename: 'main.py',
    cmd: 'python3 main.py',
  },
  javascript: {
    label: 'JavaScript (Node.js)',
    image: 'node:20-slim',
    filename: 'main.js',
    cmd: 'node main.js',
  },
  typescript: {
    label: 'TypeScript',
    image: 'denoland/deno:latest',
    filename: 'main.ts',
    cmd: 'deno run --allow-read --quiet main.ts',
  },
  java: {
    label: 'Java',
    image: 'eclipse-temurin:21-jdk',
    filename: 'Main.java', // submitted code must declare `public class Main`
    cmd: 'javac Main.java && java Main',
  },
  c: {
    label: 'C',
    image: 'gcc:13',
    filename: 'main.c',
    cmd: 'gcc main.c -o main -O2 && ./main',
  },
  cpp: {
    label: 'C++',
    image: 'gcc:13',
    filename: 'main.cpp',
    cmd: 'g++ main.cpp -o main -O2 -std=c++20 && ./main',
  },
  go: {
    label: 'Go',
    image: 'golang:1.22-alpine',
    filename: 'main.go',
    cmd: 'go run main.go',
  },
  rust: {
    label: 'Rust',
    image: 'rust:1.78-slim',
    filename: 'main.rs',
    cmd: 'rustc -O main.rs -o main 2>&1 && ./main',
  },
  ruby: {
    label: 'Ruby',
    image: 'ruby:3.3-slim',
    filename: 'main.rb',
    cmd: 'ruby main.rb',
  },
  php: {
    label: 'PHP',
    image: 'php:8.3-cli',
    filename: 'main.php',
    cmd: 'php main.php',
  },
  csharp: {
    label: 'C#',
    image: 'mono:6.12',
    filename: 'main.cs', // submitted code must declare a Main method (any class name)
    cmd: 'mcs -out:main.exe main.cs 2>&1 && mono main.exe',
  },
  bash: {
    label: 'Bash',
    image: 'bash:5.2',
    filename: 'main.sh',
    cmd: 'bash main.sh',
  },
};

const STARTERS = {
  python: 'print("Hello, world!")\n',
  javascript: 'console.log("Hello, world!");\n',
  typescript: 'const message: string = "Hello, world!";\nconsole.log(message);\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n    }\n}\n',
  c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, world!\\n");\n    return 0;\n}\n',
  cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, world!")\n}\n',
  rust: 'fn main() {\n    println!("Hello, world!");\n}\n',
  ruby: 'puts "Hello, world!"\n',
  php: '<?php\necho "Hello, world!\\n";\n',
  csharp: 'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, world!");\n    }\n}\n',
  bash: 'echo "Hello, world!"\n',
};

function listLanguages() {
  return Object.entries(LANGUAGES).map(([key, v]) => ({ key, label: v.label, starter: STARTERS[key] || '' }));
}

function getLanguage(key) {
  return LANGUAGES[key] || null;
}

module.exports = { LANGUAGES, listLanguages, getLanguage };

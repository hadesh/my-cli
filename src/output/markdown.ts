import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

chalk.level = 3;

marked.use(markedTerminal({
  code: chalk.cyan,
  blockquote: chalk.gray.italic,
  html: chalk.gray,
  heading: chalk.bold.yellow,
  firstHeading: chalk.bold.red,
  hr: chalk.gray,
  listitem: chalk.white,
  table: chalk.white,
  paragraph: chalk.white,
  strong: chalk.bold.white,
  em: chalk.italic.white,
  codespan: chalk.cyan,
  del: chalk.gray.strikethrough,
  link: chalk.blue,
  href: chalk.blue.underline,
}));

export function renderMarkdown(md: string): string {
  const result = marked.parse(md, { async: false }) as string;
  return result.trimEnd();
}

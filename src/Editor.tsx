import MDEditor, { commands, type ICommand } from "@uiw/react-md-editor";

const localized = (command: ICommand, label: string): ICommand => ({
  ...command,
  buttonProps: { ...command.buttonProps, title: label, "aria-label": label },
});
const toolbar = [
  localized(commands.bold, "加粗"),
  localized(commands.italic, "斜体"),
  localized(commands.link, "插入链接"),
  localized(commands.quote, "引用"),
  localized(commands.codeBlock, "代码块"),
  localized(commands.unorderedListCommand, "无序列表"),
  localized(commands.orderedListCommand, "有序列表"),
];

export default function Editor({
  content,
  onChange,
}: {
  content: string;
  onChange: (content: string) => void;
}) {
  return (
    <div data-color-mode="light">
      <MDEditor
        value={content}
        onChange={(value) => onChange(value || "")}
        height={560}
        preview="edit"
        commands={toolbar}
        extraCommands={[]}
        textareaProps={{ "aria-label": "SKILL.md 内容" }}
      />
    </div>
  );
}

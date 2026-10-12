import { useState } from "react";
import styles from "./style.module.css";

type Directory = { directoryId: string; path: string; available: boolean };
type ImportAction = "install" | "overwrite" | "skip";
type Preview = {
  importId: string;
  fingerprint: string;
  totalBytes: number;
  items: {
    directoryName: string;
    name: string;
    description: string;
    targetPath: string;
    conflict: boolean;
    canOverwrite: boolean;
    message?: string;
    content: string;
    files: { path: string; size: number }[];
  }[];
};
type Result = {
  directoryName: string;
  name: string;
  targetPath: string;
  status: string;
  message: string;
};

async function responseData(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || "导入失败");
  return value.data;
}

export default function ImportPanel({
  directories,
  onClose,
  onImported,
}: {
  directories: Directory[];
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const available = directories.filter((directory) => directory.available);
  const [directoryId, setDirectoryId] = useState(
    available[0]?.directoryId || "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportAction>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function resetPreview() {
    setPreview(null);
    setResults([]);
    setError("");
  }
  async function checkPackage() {
    if (!file || !directoryId) return;
    setBusy(true);
    resetPreview();
    try {
      const value: Preview = await responseData(
        await fetch(
          `/api/skills/import/preview?directoryId=${encodeURIComponent(directoryId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/zip" },
            body: file,
          },
        ),
      );
      setPreview(value);
      setDecisions(
        Object.fromEntries(
          value.items.map((item) => [
            item.directoryName,
            item.conflict ? "skip" : "install",
          ]),
        ),
      );
    } catch (error: any) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function importPackage() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const value = await responseData(
        await fetch("/api/skills/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            importId: preview.importId,
            expectedFingerprint: preview.fingerprint,
            decisions: preview.items.map((item) => ({
              directoryName: item.directoryName,
              action: decisions[item.directoryName],
            })),
          }),
        }),
      );
      setResults(value.results);
      setPreview(null);
      await onImported();
    } catch (error: any) {
      setError(error.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="导入分享包">
      <div className={styles.copyHeader}>
        <div>
          <h2>导入分享包</h2>
          <p>选择朋友分享的 ZIP，预览后安装到你的本地 Skill 目录。</p>
        </div>
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
      {!available.length && (
        <p>请先在「目录管理」中登记你的本地 Skill 根目录，再导入分享包。</p>
      )}
      <label>
        ZIP 分享包
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0] || null;
            resetPreview();
            if (selected && selected.size > 101 * 1024 * 1024) {
              setFile(null);
              setError("分享包超过上传大小限制，请选择较小的 ZIP");
            } else setFile(selected);
          }}
        />
      </label>
      <label>
        导入目标目录
        <select
          aria-label="导入目标目录"
          disabled={busy}
          value={directoryId}
          onChange={(event) => {
            setDirectoryId(event.target.value);
            resetPreview();
          }}
        >
          <option value="">请选择本地 Skill 根目录</option>
          {available.map((directory) => (
            <option key={directory.directoryId} value={directory.directoryId}>
              {directory.path}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!preview ? (
        <button
          className={styles.primary}
          disabled={busy || !file || !directoryId}
          onClick={() => void checkPackage()}
        >
          {busy ? "处理中…" : "预览导入"}
        </button>
      ) : (
        <>
          <p>
            {preview.items.length} 个 Skill，
            {preview.totalBytes.toLocaleString("zh-CN")}{" "}
            字节。请检查文件和指令内容后再安装。
          </p>
          {preview.items.map((item) => (
            <div className={styles.importItem} key={item.directoryName}>
              <div className={styles.copyHeader}>
                <div>
                  <h3>{item.name}</h3>
                  <code>{item.targetPath}</code>
                  {item.description && <p>{item.description}</p>}
                </div>
                <label>
                  {item.conflict ? "目标已存在" : "新 Skill"}
                  <select
                    aria-label={`${item.name} 的导入方式`}
                    disabled={busy}
                    value={decisions[item.directoryName]}
                    onChange={(event) =>
                      setDecisions({
                        ...decisions,
                        [item.directoryName]: event.target
                          .value as ImportAction,
                      })
                    }
                  >
                    {!item.conflict && <option value="install">导入</option>}
                    <option value="skip">跳过</option>
                    {item.conflict && item.canOverwrite && (
                      <option value="overwrite">
                        覆盖同名文件，保留本地独有文件
                      </option>
                    )}
                  </select>
                </label>
              </div>
              {item.message && <p>{item.message}</p>}
              <details>
                <summary>查看 {item.files.length} 个文件</summary>
                <div className={styles.exportList}>
                  {item.files.map((file) => (
                    <code key={file.path}>{file.path}</code>
                  ))}
                </div>
              </details>
              <details>
                <summary>查看 Skill 指令</summary>
                <pre className={styles.exportList}>{item.content}</pre>
              </details>
            </div>
          ))}
          <button
            className={styles.primary}
            disabled={
              busy ||
              preview.items.every(
                (item) => decisions[item.directoryName] === "skip",
              )
            }
            onClick={() => void importPackage()}
          >
            {busy ? "导入中…" : "开始导入"}
          </button>
        </>
      )}
      {results.length > 0 && (
        <div className={styles.copyResults} role="status">
          <h3>导入结果</h3>
          {results.map((item) => (
            <p key={item.directoryName}>
              <span className={styles[item.status] || styles.invalid}>
                {item.status === "success"
                  ? "成功"
                  : item.status === "skipped"
                    ? "已跳过"
                    : "失败"}
              </span>{" "}
              {item.name}：{item.message}
              <br />
              <code>{item.targetPath}</code>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

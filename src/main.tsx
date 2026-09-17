import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import YAML from "yaml";
import styles from "./style.module.css";
const Editor = lazy(() => import("./Editor"));

async function api(url: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.error.message), {
      code: value.error.code,
    });
  return value.data;
}
function ErrorBox({ error }: { error: string }) {
  return error ? (
    <p role="alert" className={styles.error}>
      {error}
    </p>
  ) : null;
}
function hasChinese(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}
function List() {
  const [data, setData] = useState<any>({ skills: [], errors: [] });
  const [directories, setDirectories] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("modifiedAt:desc");
  const [directoryFilter, setDirectoryFilter] = useState("");
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh(nextDirectoryFilter = directoryFilter) {
    setBusy(true);
    setError("");
    try {
      const directoryParam = nextDirectoryFilter
        ? `&directoryId=${encodeURIComponent(nextDirectoryFilter)}`
        : "";
      const [skills, dirs] = await Promise.all([
        api(
          `/skills?query=${encodeURIComponent(query)}&sort=${sort}${directoryParam}`,
        ),
        api("/directories"),
      ]);
      setData(skills);
      setDirectories(dirs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>你的本地工作台</p>
          <h1>Skill 管理器</h1>
          <p>登记目录，集中查看和维护你的技能。</p>
        </div>
        <Link className={styles.primary} to="/create">
          ＋ 新建 Skill
        </Link>
      </div>
      <details className={styles.panel} open={directories.length === 0}>
        <summary>目录管理 · {directories.length} 个目录</summary>
        <p>添加本机 Skill 根目录后，扫描其中的直接子目录。</p>
        <form
          className={styles.row}
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/directories", "POST", { path: directory });
              setDirectory("");
              await refresh();
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          <input
            aria-label="Skill 根目录"
            placeholder="输入绝对路径，例如 ~/my-skills"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            required
          />
          <button>登记目录</button>
        </form>
        {directories.map((d) => (
          <div className={styles.directory} key={d.directoryId}>
            <span>
              {d.path}
              {!d.available && (
                <small className={styles.error}> · {d.error}</small>
              )}
            </span>
            <button
              onClick={async () => {
                if (!confirm("移除目录登记？磁盘文件会保留。")) return;
                try {
                  await api(`/directories/${d.directoryId}`, "DELETE");
                  await refresh();
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              移除登记
            </button>
          </div>
        ))}
      </details>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          void refresh();
        }}
      >
        <input
          aria-label="搜索 Skill"
          placeholder="搜索名称或描述…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="排序"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="modifiedAt:desc">最近修改优先</option>
          <option value="modifiedAt:asc">最早修改优先</option>
        </select>
        <select
          aria-label="目录筛选"
          value={directoryFilter}
          onChange={(e) => {
            setDirectoryFilter(e.target.value);
            void refresh(e.target.value);
          }}
        >
          <option value="">全部目录</option>
          {directories.map((d) => (
            <option key={d.directoryId} value={d.directoryId}>
              {d.path}
              {!d.available ? "（不可用）" : ""}
            </option>
          ))}
        </select>
        <button disabled={busy}>{busy ? "扫描中…" : "搜索 / 刷新"}</button>
      </form>
      <ErrorBox error={error} />
      {data.errors.map((e: any) => (
        <ErrorBox key={e.path} error={`${e.path}：${e.message}`} />
      ))}
      <div className={styles.grid}>
        {data.skills.map((s: any) => (
          <Link
            className={styles.card}
            to={`/skills/${s.skillId}`}
            key={s.skillId}
          >
            <span
              className={
                s.fileStatus === "invalid" ? styles.invalid : styles.badge
              }
            >
              {s.fileStatus === "invalid" ? "需要修复" : "正常"}
            </span>
            <h2>{s.name}</h2>
            <p>{s.description || "暂无描述"}</p>
            <code>{s.realPath}</code>
            {s.parseError && (
              <p className={styles.error}>{s.parseError.message}</p>
            )}
            <small>
              {s.modifiedAt
                ? new Date(s.modifiedAt).toLocaleString("zh-CN")
                : "修改时间不可用"}
            </small>
          </Link>
        ))}
      </div>
      {!busy && data.skills.length === 0 && (
        <div className={styles.empty}>
          <h2>
            {directories.length ? "没有找到 Skill" : "从登记一个目录开始"}
          </h2>
          <p>
            {directories.length
              ? "目录的直接子目录需包含 SKILL.md，也可以新建一个 Skill。"
              : "展开目录管理，输入你希望管理的 Skill 根目录。"}
          </p>
        </div>
      )}
    </>
  );
}
function Detail() {
  const { skillId } = useParams();
  const [detail, setDetail] = useState<any>();
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [originalDescription, setOriginalDescription] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const value = await api(`/skills/${skillId}`);
      setDetail(value);
      setContent(value.content);
      const sourceDescription = value.description || "";
      setOriginalDescription(sourceDescription);
      setDescription(hasChinese(sourceDescription) ? sourceDescription : "");
      setConflict(false);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void load();
  }, [skillId]);
  async function save(force = false) {
    setBusy(true);
    setMessage("");
    try {
      const value = await api(`/skills/${skillId}`, "PUT", {
        content,
        description,
        expectedFingerprint: detail.fingerprint,
        force,
      });
      setDetail({ ...detail, fingerprint: value.fingerprint });
      setConflict(false);
      setError("");
      setMessage("保存成功");
    } catch (e: any) {
      setError(e.message);
      setConflict(e.code === "CONFLICT");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/">← 返回列表</Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>SKILL.md 编辑</p>
          <h1>{detail?.name || "Skill 详情"}</h1>
          <code>{detail?.realPath}</code>
        </div>
        <button
          className={styles.primary}
          disabled={!detail || busy}
          onClick={() => void save()}
        >
          {busy ? "保存中…" : "保存修改"}
        </button>
      </div>
      <ErrorBox error={error} />
      {message && <p role="status">{message}</p>}
      {detail && (
        <label className={styles.descriptionField}>
          中文简介
          {originalDescription && !hasChinese(originalDescription) && (
            <small className={styles.sourceDescription}>
              原始英文描述：{originalDescription}
            </small>
          )}
          <textarea
            rows={3}
            placeholder="请填写中文简介，保存后会写入 SKILL.md 的 description 字段"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      )}
      {conflict && (
        <div className={styles.panel}>
          <p>磁盘文件已经改变。你当前的编辑草稿仍保留在下方。</p>
          <button
            onClick={() => {
              if (confirm("重新读取磁盘版本会丢弃当前草稿，继续？"))
                void load();
            }}
          >
            读取磁盘版本
          </button>{" "}
          <button
            onClick={() => {
              if (confirm("确定用当前草稿覆盖磁盘上的最新内容？"))
                void save(true);
            }}
          >
            确认覆盖
          </button>
        </div>
      )}
      {detail?.parseError && (
        <ErrorBox
          error={`解析异常，可在下方修复：${detail.parseError.message}`}
        />
      )}{" "}
      {detail && (
        <Suspense fallback={<p>正在加载编辑器…</p>}>
          <Editor content={content} onChange={setContent} />
        </Suspense>
      )}
    </>
  );
}
function Create() {
  const navigate = useNavigate();
  const [directories, setDirectories] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [content, setContent] = useState("");
  const [contentEdited, setContentEdited] = useState(false);
  const [form, setForm] = useState({
    targetDirectoryIds: [] as string[],
    directoryName: "",
    name: "",
    description: "",
    whenToUse: "",
    instructions: "",
  });
  useEffect(() => {
    api("/directories")
      .then((d) => {
        const available = d.filter((item: any) => item.available);
        setDirectories(available);
        setForm((f) => ({
          ...f,
          targetDirectoryIds: available[0] ? [available[0].directoryId] : [],
        }));
      })
      .catch((e) => setError(e.message));
  }, []);
  const preview = `---\n${YAML.stringify({ name: form.name, description: form.description })}---\n\n## When to use\n\n${form.whenToUse}\n\n## Instructions\n\n${form.instructions}\n`;
  useEffect(() => {
    if (!contentEdited) setContent(preview);
  }, [preview, contentEdited]);
  return (
    <>
      <Link to="/">← 返回列表</Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>建立新的能力</p>
          <h1>新建 Skill</h1>
          <p>填写内容，生成标准的 SKILL.md 文件。</p>
        </div>
      </div>
      <ErrorBox error={error} />
      {!directories.length && <p>暂无可用目录，请先返回列表登记目录。</p>}
      <div className={styles.columns}>
        <form
          className={styles.panel}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const value = await api("/skills", "POST", { ...form, content });
              navigate(`/skills/${value.skillId}`);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            目标目录
            <select
              multiple
              size={Math.min(Math.max(directories.length, 2), 5)}
              required
              value={form.targetDirectoryIds}
              onChange={(e) =>
                setForm({
                  ...form,
                  targetDirectoryIds: Array.from(
                    e.target.selectedOptions,
                    (option) => option.value,
                  ),
                })
              }
            >
              {directories.map((d) => (
                <option key={d.directoryId} value={d.directoryId}>
                  {d.path}
                </option>
              ))}
            </select>
          </label>
          <label>
            名称
            <input
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  directoryName: manual
                    ? form.directoryName
                    : e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                })
              }
            />
          </label>
          <label>
            目录名
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="只允许小写字母、数字和连字符"
              value={form.directoryName}
              onChange={(e) => {
                setManual(true);
                setForm({ ...form, directoryName: e.target.value });
              }}
            />
            <small>小写字母、数字和连字符，例如 my-skill</small>
          </label>
          {(["description", "whenToUse", "instructions"] as const).map(
            (field, i) => (
              <label key={field}>
                {["描述", "适用场景", "指令"][i]}
                <textarea
                  rows={i === 2 ? 6 : 3}
                  value={form[field]}
                  onChange={(e) =>
                    setForm({ ...form, [field]: e.target.value })
                  }
                />
              </label>
            ),
          )}
          <div className={styles.row}>
            <button
              type="button"
              onClick={() => {
                setForm({
                  ...form,
                  name: "",
                  description: "",
                  whenToUse: "",
                  instructions: "",
                });
                setContentEdited(false);
              }}
            >
              空白模板
            </button>
            <button
              className={styles.primary}
              disabled={!directories.length || busy}
            >
              {busy ? "创建中…" : "创建 Skill"}
            </button>
          </div>
        </form>
        <div className={styles.panel}>
          <h2>文件预览</h2>
          <p>可直接编辑下方内容，提交时将按当前内容写入所选目录。</p>
          <Suspense fallback={<p>正在加载编辑器…</p>}>
            <Editor
              content={content || preview}
              onChange={(value) => {
                setContentEdited(true);
                setContent(value);
              }}
            />
          </Suspense>
        </div>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <main className={styles.main}>
      <Routes>
        <Route path="/" element={<List />} />
        <Route path="/skills/:skillId" element={<Detail />} />
        <Route path="/create" element={<Create />} />
        <Route path="*" element={<Link to="/">页面不存在，返回列表</Link>} />
      </Routes>
      <footer>本地 Skill 工作台 · 内容存储在你的电脑中</footer>
    </main>
  </BrowserRouter>,
);

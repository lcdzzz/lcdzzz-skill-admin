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
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const [copyMode, setCopyMode] = useState("skill_md_only");
  const [copyPreview, setCopyPreview] = useState<any[]>([]);
  const [copyDecisions, setCopyDecisions] = useState<Record<string, string>>(
    {},
  );
  const [copyResults, setCopyResults] = useState<any[]>([]);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncSource, setSyncSource] = useState("");
  const [syncTargets, setSyncTargets] = useState<string[]>([]);
  const [syncPreview, setSyncPreview] = useState<any[]>([]);
  const [syncDecisions, setSyncDecisions] = useState<Record<string, string>>(
    {},
  );
  const [syncResults, setSyncResults] = useState<any[]>([]);
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
  const selectedSkills = data.skills.filter((skill: any) =>
    selectedSkillIds.includes(skill.skillId),
  );
  const selectedSourceDirectories = new Set(
    selectedSkills.map((skill: any) => skill.directoryId),
  );
  const decisionKey = (skillId: string, directoryId: string) =>
    `${skillId}:${directoryId}`;
  async function previewCopy() {
    setBusy(true);
    setError("");
    try {
      const value = await api("/skills/copy/preview", "POST", {
        skillIds: selectedSkillIds,
        targetDirectoryIds: copyTargets,
      });
      setCopyPreview(value.items);
      setCopyDecisions(
        Object.fromEntries(
          value.items
            .filter((item: any) => item.conflict)
            .map((item: any) => [
              decisionKey(item.skillId, item.targetDirectoryId),
              "",
            ]),
        ),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function executeCopy() {
    setBusy(true);
    setError("");
    try {
      const decisions = copyPreview
        .filter((item: any) => item.conflict)
        .map((item: any) => ({
          skillId: item.skillId,
          targetDirectoryId: item.targetDirectoryId,
          action:
            copyDecisions[decisionKey(item.skillId, item.targetDirectoryId)],
        }));
      const value = await api("/skills/copy", "POST", {
        skillIds: selectedSkillIds,
        targetDirectoryIds: copyTargets,
        mode: copyMode,
        decisions,
      });
      setCopyResults(value.results);
      setSelectedSkillIds([]);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const syncDecisionKey = (sourceSkillId: string, targetDirectoryId: string) =>
    `${sourceSkillId}:${targetDirectoryId}`;
  async function previewSync() {
    setBusy(true);
    setError("");
    try {
      const value = await api("/skills/sync/preview", "POST", {
        sourceDirectoryId: syncSource,
        targetDirectoryIds: syncTargets,
      });
      setSyncPreview(value.items);
      setSyncDecisions(
        Object.fromEntries(
          value.items
            .filter((item: any) => item.match)
            .map((item: any) => [
              syncDecisionKey(item.sourceSkillId, item.targetDirectoryId),
              "",
            ]),
        ),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function executeSync() {
    setBusy(true);
    setError("");
    try {
      const value = await api("/skills/sync", "POST", {
        sourceDirectoryId: syncSource,
        targetDirectoryIds: syncTargets,
        decisions: syncPreview
          .filter((item: any) => item.match)
          .map((item: any) => ({
            sourceSkillId: item.sourceSkillId,
            targetDirectoryId: item.targetDirectoryId,
            action:
              syncDecisions[
                syncDecisionKey(item.sourceSkillId, item.targetDirectoryId)
              ],
          })),
      });
      setSyncResults(value.results);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>你的本地工作台</p>
          <h1>Skill 管理器</h1>
          <p>登记目录，集中查看和维护你的技能。</p>
        </div>
        <div className={styles.row}>
          <Link to="/operations">操作记录</Link>
          <button
            disabled={!selectedSkills.length || busy}
            onClick={() => {
              if (selectedSourceDirectories.size !== 1) {
                setError("请选择同一来源目录的 Skill 后再复制");
                return;
              }
              setCopyOpen(true);
              setCopyPreview([]);
              setCopyDecisions({});
              setCopyResults([]);
            }}
          >
            复制 Skill
            {selectedSkills.length ? `（${selectedSkills.length}）` : ""}
          </button>
          <button
            disabled={busy || !directories.some((item) => item.available)}
            onClick={() => {
              setSyncOpen(true);
              setSyncSource("");
              setSyncTargets([]);
              setSyncPreview([]);
              setSyncDecisions({});
              setSyncResults([]);
            }}
          >
            同步 Skill
          </button>
          <Link className={styles.primary} to="/create">
            ＋ 新建 Skill
          </Link>
        </div>
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
      {syncOpen && (
        <section className={styles.panel}>
          <div className={styles.copyHeader}>
            <div>
              <h2>同步同名 Skill</h2>
              <p>只同步目标目录中已经存在的相同 Skill，不会创建缺失项。</p>
            </div>
            <button
              onClick={() => {
                setSyncOpen(false);
                setSyncPreview([]);
                setSyncResults([]);
              }}
            >
              关闭
            </button>
          </div>
          <label>
            源目录
            <select
              value={syncSource}
              onChange={(event) => {
                setSyncSource(event.target.value);
                setSyncPreview([]);
                setSyncResults([]);
              }}
            >
              <option value="">请选择源目录</option>
              {directories.map((directory: any) => (
                <option
                  key={directory.directoryId}
                  value={directory.directoryId}
                  disabled={!directory.available}
                >
                  {directory.path}
                  {!directory.available ? "（不可用）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标目录
            <select
              multiple
              required
              size={Math.min(Math.max(directories.length, 2), 5)}
              value={syncTargets}
              onChange={(event) => {
                setSyncTargets(
                  Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                );
                setSyncPreview([]);
                setSyncResults([]);
              }}
            >
              {directories.map((directory: any) => (
                <option
                  key={directory.directoryId}
                  value={directory.directoryId}
                  disabled={
                    !directory.available || directory.directoryId === syncSource
                  }
                >
                  {directory.path}
                  {!directory.available ? "（不可用）" : ""}
                </option>
              ))}
            </select>
          </label>
          {!syncPreview.length ? (
            <button
              className={styles.primary}
              disabled={!syncSource || !syncTargets.length || busy}
              onClick={() => void previewSync()}
            >
              {busy ? "检查中…" : "检查可同步项"}
            </button>
          ) : (
            <>
              <div className={styles.conflicts}>
                <h3>同步预览</h3>
                {syncPreview.map((item: any) => {
                  const key = syncDecisionKey(
                    item.sourceSkillId,
                    item.targetDirectoryId,
                  );
                  return (
                    <label className={styles.conflict} key={key}>
                      <span>
                        {item.skillName} → {item.targetPath || "目标缺失"}
                        {!item.match ? "（跳过）" : ""}
                      </span>
                      {item.match ? (
                        <select
                          value={syncDecisions[key] || ""}
                          onChange={(event) =>
                            setSyncDecisions({
                              ...syncDecisions,
                              [key]: event.target.value,
                            })
                          }
                        >
                          <option value="">请选择</option>
                          <option value="skip">跳过</option>
                          <option value="overwrite">覆盖</option>
                          <option value="cancel">取消</option>
                        </select>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              <button
                className={styles.primary}
                disabled={
                  busy ||
                  syncPreview.some(
                    (item: any) =>
                      item.match &&
                      !syncDecisions[
                        syncDecisionKey(
                          item.sourceSkillId,
                          item.targetDirectoryId,
                        )
                      ],
                  )
                }
                onClick={() => void executeSync()}
              >
                {busy ? "同步中…" : "开始同步"}
              </button>
            </>
          )}
          {syncResults.length > 0 && (
            <div className={styles.copyResults}>
              <h3>同步结果</h3>
              {syncResults.map((item: any) => (
                <p key={`${item.sourceSkillId}:${item.directoryId}`}>
                  <span className={styles[item.status] || styles.invalid}>
                    {item.status === "success"
                      ? "成功"
                      : item.status === "skipped"
                        ? "已跳过"
                        : item.status === "cancelled"
                          ? "已取消"
                          : "失败"}
                  </span>{" "}
                  {item.targetPath}：{item.message}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
      {copyOpen && (
        <section className={styles.panel}>
          <div className={styles.copyHeader}>
            <div>
              <h2>复制 {selectedSkills.length} 个 Skill</h2>
              <p>选择已登记的目标目录；默认只复制 SKILL.md。</p>
            </div>
            <button
              onClick={() => {
                setCopyOpen(false);
                setCopyPreview([]);
                setCopyResults([]);
              }}
            >
              关闭
            </button>
          </div>
          <label>
            目标目录
            <select
              multiple
              required
              size={Math.min(Math.max(directories.length, 2), 5)}
              value={copyTargets}
              onChange={(event) => {
                setCopyTargets(
                  Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                );
                setCopyPreview([]);
                setCopyResults([]);
              }}
            >
              {directories.map((directory: any) => (
                <option
                  key={directory.directoryId}
                  value={directory.directoryId}
                  disabled={!directory.available}
                >
                  {directory.path}
                  {!directory.available ? "（不可用）" : ""}
                </option>
              ))}
            </select>
          </label>
          <fieldset className={styles.copyMode}>
            <legend>复制方式</legend>
            <label>
              <input
                type="radio"
                value="skill_md_only"
                checked={copyMode === "skill_md_only"}
                onChange={(event) => setCopyMode(event.target.value)}
              />
              仅复制 SKILL.md（默认）
            </label>
            <label>
              <input
                type="radio"
                value="full_directory"
                checked={copyMode === "full_directory"}
                onChange={(event) => setCopyMode(event.target.value)}
              />
              复制完整 Skill 目录
            </label>
          </fieldset>
          {!copyPreview.length ? (
            <button
              className={styles.primary}
              disabled={!copyTargets.length || busy}
              onClick={() => void previewCopy()}
            >
              {busy ? "检查中…" : "检查冲突"}
            </button>
          ) : (
            <>
              {copyPreview.some((item: any) => item.conflict) && (
                <div className={styles.conflicts}>
                  <h3>发现同名 Skill</h3>
                  {copyPreview
                    .filter((item: any) => item.conflict)
                    .map((item: any) => {
                      const skill = selectedSkills.find(
                        (candidate: any) => candidate.skillId === item.skillId,
                      );
                      const key = decisionKey(
                        item.skillId,
                        item.targetDirectoryId,
                      );
                      return (
                        <label className={styles.conflict} key={key}>
                          <span>
                            {skill?.name || skill?.directoryName} →{" "}
                            {item.targetPath}
                          </span>
                          <select
                            value={copyDecisions[key] || ""}
                            onChange={(event) =>
                              setCopyDecisions({
                                ...copyDecisions,
                                [key]: event.target.value,
                              })
                            }
                          >
                            <option value="">请选择</option>
                            <option value="skip">跳过</option>
                            <option value="overwrite">覆盖</option>
                            <option value="cancel">取消</option>
                          </select>
                        </label>
                      );
                    })}
                </div>
              )}
              <button
                className={styles.primary}
                disabled={
                  busy ||
                  copyPreview.some(
                    (item: any) =>
                      item.conflict &&
                      !copyDecisions[
                        decisionKey(item.skillId, item.targetDirectoryId)
                      ],
                  )
                }
                onClick={() => void executeCopy()}
              >
                {busy ? "复制中…" : "开始复制"}
              </button>
            </>
          )}
          {copyResults.length > 0 && (
            <div className={styles.copyResults}>
              <h3>复制结果</h3>
              {copyResults.map((item: any) => (
                <p key={`${item.skillId}:${item.directoryId}`}>
                  <span className={styles[item.status] || styles.invalid}>
                    {item.status === "success"
                      ? "成功"
                      : item.status === "skipped"
                        ? "已跳过"
                        : item.status === "cancelled"
                          ? "已取消"
                          : "失败"}
                  </span>{" "}
                  {item.targetPath}
                  {item.message ? `：${item.message}` : ""}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
      {data.errors.map((e: any) => (
        <ErrorBox key={e.path} error={`${e.path}：${e.message}`} />
      ))}
      <div className={styles.grid}>
        {data.skills.map((s: any) => (
          <article className={styles.card} key={s.skillId}>
            <label className={styles.cardSelection}>
              <input
                type="checkbox"
                checked={selectedSkillIds.includes(s.skillId)}
                onChange={(event) =>
                  setSelectedSkillIds(
                    event.target.checked
                      ? [...selectedSkillIds, s.skillId]
                      : selectedSkillIds.filter((id) => id !== s.skillId),
                  )
                }
              />
              选择
            </label>
            <Link className={styles.cardLink} to={`/skills/${s.skillId}`}>
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
          </article>
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
function Operations() {
  const [operations, setOperations] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(10);
  async function load(nextLimit = limit) {
    setBusy(true);
    setError("");
    try {
      const value = await api(`/operations?limit=${nextLimit}`);
      setOperations(value.operations);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const operationName: Record<string, string> = {
    create: "创建",
    read: "查看",
    update: "修改",
    delete: "移除登记",
    copy: "复制",
    sync: "同步",
  };
  const statusName: Record<string, string> = {
    success: "成功",
    failed: "失败",
    rolled_back: "已回滚",
    skipped: "已跳过",
    cancelled: "已取消",
  };
  return (
    <>
      <Link to="/">← 返回列表</Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>本机操作留痕</p>
          <h1>操作记录</h1>
          <p>按时间倒序查看创建、修改、复制和目录登记变更。</p>
        </div>
        <div className={styles.row}>
          <label className={styles.operationLimit}>
            最近
            <select
              value={limit}
              onChange={(event) => {
                const nextLimit = Number(event.target.value);
                setLimit(nextLimit);
                void load(nextLimit);
              }}
            >
              {[10, 20, 50, 100].map((option) => (
                <option key={option} value={option}>
                  {option} 条
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy} onClick={() => void load()}>
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <section className={styles.operationList}>
        {operations.map((item) => (
          <article className={styles.operation} key={item.id}>
            <div className={styles.operationHeader}>
              <strong>{operationName[item.operation] || item.operation}</strong>
              <span className={styles[item.status] || styles.invalid}>
                {statusName[item.status] || item.status}
              </span>
              <time>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
            </div>
            {item.path && <code>{item.path}</code>}
            {item.message && <p>{item.message}</p>}
            {item.errorCode && <small>错误码：{item.errorCode}</small>}
          </article>
        ))}
        {!busy && operations.length === 0 && (
          <div className={styles.empty}>
            <h2>还没有操作记录</h2>
            <p>创建、修改、复制或移除登记后，记录会显示在这里。</p>
          </div>
        )}
      </section>
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
        <Route path="/operations" element={<Operations />} />
        <Route path="/skills/:skillId" element={<Detail />} />
        <Route path="/create" element={<Create />} />
        <Route path="*" element={<Link to="/">页面不存在，返回列表</Link>} />
      </Routes>
      <footer>本地 Skill 工作台 · 内容存储在你的电脑中</footer>
    </main>
  </BrowserRouter>,
);

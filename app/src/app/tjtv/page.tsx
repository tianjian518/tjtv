'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * tjtv 源管理页 —— 图形界面版 /api/tjtv/sources
 * 打开 http://localhost:8021/tjtv 即可增删启停源，改完刷新首页就生效。
 */

interface Src {
  key: string;
  name: string;
  url: string;
  builtin?: boolean;
  note?: string;
  enabled?: boolean;
  addedAt?: string;
}

interface ListResp {
  count?: number;
  enabled?: number;
  dataFile?: string;
  sources?: Src[];
  error?: string;
}

export default function TjtvAdminPage() {
  const [list, setList] = useState<Src[]>([]);
  const [dataFile, setDataFile] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [skipCheck, setSkipCheck] = useState(false);
  const [busy, setBusy] = useState(false);

  const flash = (type: 'ok' | 'err' | 'info', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 6000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/tjtv/sources', { cache: 'no-store' });
      const j = (await r.json()) as ListResp;
      setList(j.sources || []);
      setDataFile(j.dataFile || '');
    } catch {
      flash('err', '读取源列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!name.trim() || !url.trim()) {
      flash('err', '名称和地址都要填');
      return;
    }
    setBusy(true);
    flash('info', '正在探活这个源，稍等...');
    try {
      const r = await fetch('/api/tjtv/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), note: note.trim() || undefined, skipCheck }),
      });
      const j = (await r.json()) as { error?: string; check?: { reason?: string; sample?: string } };
      if (r.ok) {
        flash('ok', `添加成功${j.check?.reason ? `（${j.check.reason}）` : ''}`);
        setName(''); setUrl(''); setNote('');
        await load();
      } else {
        flash('err', j.error || '添加失败');
      }
    } catch {
      flash('err', '请求出错');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Src) => {
    if (!confirm(`确定删除源「${s.name}」？`)) return;
    const r = await fetch('/api/tjtv/sources', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: s.key }),
    });
    const j = (await r.json()) as { error?: string };
    if (r.ok) { flash('ok', '已删除'); await load(); }
    else flash('err', j.error || '删除失败');
  };

  const toggle = async (s: Src) => {
    const r = await fetch('/api/tjtv/sources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: s.key, enabled: s.enabled === false }),
    });
    const j = (await r.json()) as { error?: string };
    if (r.ok) await load();
    else flash('err', j.error || '操作失败');
  };

  const color = (t: string) =>
    t === 'ok' ? '#16a34a' : t === 'err' ? '#dc2626' : '#2563eb';

  return (
    <div style={{
      minHeight: '100vh', background: '#f6f7f9', color: '#111827',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
      padding: '28px 16px',
    }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>tjtv 源管理</h1>
          <span style={{ color: '#6b7280', fontSize: 13 }}>内置源开箱可用 · 新增源即时生效</span>
        </div>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0 }}>
          源清单持久化在服务端，换设备、换浏览器都共享同一份。
        </p>

        {msg && (
          <div style={{
            background: '#fff', borderLeft: `4px solid ${color(msg.type)}`,
            padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 14,
            boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          }}>{msg.text}</div>
        )}

        {/* 新增源 */}
        <div style={{
          background: '#fff', borderRadius: 10, padding: 20, marginBottom: 20,
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 14px' }}>添加新源</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
            <input
              placeholder="源名称，如 某某影视"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                padding: '9px 12px', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: 14, outline: 'none',
              }}
            />
            <input
              placeholder="接口地址，如 https://example.com/api.php/provide/vod"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{
                padding: '9px 12px', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: 14, outline: 'none',
              }}
            />
          </div>
          <input
            placeholder="备注（可选），用来标记这个源的特点"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px', border: '1px solid #d1d5db',
              borderRadius: 6, fontSize: 14, outline: 'none', marginBottom: 12,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={() => void add()}
              disabled={busy}
              style={{
                background: busy ? '#9ca3af' : '#2563eb', color: '#fff', border: 0,
                padding: '9px 22px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >{busy ? '处理中...' : '添加'}</button>
            <label style={{ fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={skipCheck} onChange={(e) => setSkipCheck(e.target.checked)} />
              跳过探活直接添加（源暂时连不上时用）
            </label>
          </div>
        </div>

        {/* 源列表 */}
        <div style={{
          background: '#fff', borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}>
          <div style={{
            padding: '14px 20px', borderBottom: '1px solid #e5e7eb',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              当前源列表（{list.length}）
            </h2>
            <button
              onClick={() => void load()}
              style={{
                background: '#fff', border: '1px solid #d1d5db', padding: '5px 12px',
                borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#374151',
              }}
            >刷新</button>
          </div>

          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>加载中...</div>
          ) : list.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>还没有任何源</div>
          ) : (
            list.map((s, i) => (
              <div key={s.key} style={{
                padding: '14px 20px',
                borderBottom: i < list.length - 1 ? '1px solid #f3f4f6' : 'none',
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: s.enabled === false ? 0.45 : 1,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</span>
                    {s.builtin && (
                      <span style={{
                        background: '#dbeafe', color: '#1d4ed8', fontSize: 11,
                        padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                      }}>内置</span>
                    )}
                    {s.enabled === false && (
                      <span style={{
                        background: '#f3f4f6', color: '#6b7280', fontSize: 11,
                        padding: '2px 7px', borderRadius: 4,
                      }}>已停用</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12.5, color: '#6b7280', wordBreak: 'break-all',
                    fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
                  }}>{s.url}</div>
                  {s.note && (
                    <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 3 }}>{s.note}</div>
                  )}
                </div>

                {!s.builtin && (
                  <>
                    <button
                      onClick={() => void toggle(s)}
                      style={{
                        background: '#fff', border: '1px solid #d1d5db', padding: '5px 12px',
                        borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#374151',
                        whiteSpace: 'nowrap',
                      }}
                    >{s.enabled === false ? '启用' : '停用'}</button>
                    <button
                      onClick={() => void remove(s)}
                      style={{
                        background: '#fff', border: '1px solid #fecaca', padding: '5px 12px',
                        borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#dc2626',
                        whiteSpace: 'nowrap',
                      }}
                    >删除</button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* 接口说明 */}
        <div style={{
          background: '#fff', borderRadius: 10, padding: 20, marginTop: 20,
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
            接口调用（给脚本/自动化用）
          </h2>
          <div style={{ fontSize: 13, lineHeight: 1.9, color: '#374151' }}>
            <div><b>查看全部源</b>：<code>GET /api/tjtv/sources</code></div>
            <div><b>新增源</b>：<code>POST /api/tjtv/sources</code>，body <code>{`{"name":"源名","url":"https://..."}`}</code></div>
            <div><b>删除源</b>：<code>DELETE /api/tjtv/sources</code>，body <code>{`{"key":"..."}`}</code></div>
            <div><b>启停源</b>：<code>PATCH /api/tjtv/sources</code>，body <code>{`{"key":"...","enabled":false}`}</code></div>
          </div>
          <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 12, wordBreak: 'break-all' }}>
            数据文件：{dataFile || '(读取中)'}
          </div>
        </div>

        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12.5, marginTop: 24 }}>
          <Link href="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← 返回首页搜索观看</Link>
        </div>
      </div>
    </div>
  );
}

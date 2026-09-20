import { describe, expect, it } from 'vitest';
import { isPrivateIP, isValidProxyUrl } from './ssrf';

describe('isPrivateIP', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['192.168.1.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['8.8.8.8', false],
    ['1.2.3.4', false],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });
});

describe('isValidProxyUrl', () => {
  it('放行公网 http(s)', () => {
    expect(isValidProxyUrl('https://cdn.example.com/a.m3u8')).toBe(true);
    expect(isValidProxyUrl('http://1.2.3.4/x.ts')).toBe(true);
  });

  it('拦截内网与保留地址', () => {
    expect(isValidProxyUrl('http://localhost/x')).toBe(false);
    expect(isValidProxyUrl('http://127.0.0.1/x')).toBe(false);
    expect(isValidProxyUrl('http://192.168.1.1/x')).toBe(false);
    expect(isValidProxyUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('拦截非 http 协议', () => {
    expect(isValidProxyUrl('file:///etc/passwd')).toBe(false);
    expect(isValidProxyUrl('ftp://x.com/a')).toBe(false);
    expect(isValidProxyUrl('not a url')).toBe(false);
  });
});

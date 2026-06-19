'use strict';
jest.mock('fs');
jest.mock('child_process');

const fs   = require('fs');
const cp   = require('child_process');
const path = require('path');

// EventEmitter-based mock for child process
const EventEmitter = require('events');
function makeChild(pid = 1234) {
  const c = new EventEmitter();
  c.pid    = pid;
  c.killed = false;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill   = jest.fn(() => { c.killed = true; });
  return c;
}

const agentsModule = require('../agent-hub/agents');
const STATUS_FILE = '/root/agent-status.json';
const ROOT        = '/root';

beforeEach(() => {
  jest.clearAllMocks();

  // Default fs stubs
  fs.existsSync.mockReturnValue(false);
  fs.readFileSync.mockReturnValue('{}');
  fs.writeFileSync.mockImplementation(() => {});
  fs.appendFileSync.mockImplementation(() => {});

  // Reset pipeline status between tests
  agentsModule.pipelineStatus = null;
});

// ─── AGENTS constant ────────────────────────────────────────────────────────

describe('AGENTS', () => {
  test('has four agents with required keys', () => {
    const { AGENTS } = agentsModule;
    expect(Object.keys(AGENTS)).toEqual(['mali', 'manao', 'namkhao', 'anime']);
    for (const key of Object.keys(AGENTS)) {
      expect(AGENTS[key]).toHaveProperty('label');
      expect(AGENTS[key]).toHaveProperty('actions');
    }
  });
});

// ─── readStatus / writeStatus ────────────────────────────────────────────────

describe('readStatus', () => {
  test('parses JSON from file', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    const s = agentsModule.readStatus(STATUS_FILE);
    expect(s.mali.status).toBe('idle');
  });

  test('returns default when file missing or corrupt', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const s = agentsModule.readStatus(STATUS_FILE);
    expect(s).toHaveProperty('mali');
    expect(s.mali.status).toBe('idle');
  });
});

describe('writeStatus', () => {
  test('writes JSON to STATUS_FILE', () => {
    const data = { mali: { status: 'running' } };
    agentsModule.writeStatus(STATUS_FILE, data);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      STATUS_FILE,
      JSON.stringify(data, null, 2),
      'utf8'
    );
  });
});

// ─── readLog ─────────────────────────────────────────────────────────────────

describe('readLog', () => {
  test('returns empty array when log file missing', () => {
    fs.existsSync.mockReturnValue(false);
    const result = agentsModule.readLog(ROOT, 'mali');
    expect(result).toEqual([]);
  });

  test('returns last N lines from log file', () => {
    fs.existsSync.mockReturnValue(true);
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    fs.readFileSync.mockReturnValue(lines);
    const result = agentsModule.readLog(ROOT, 'mali', 5);
    expect(result).toHaveLength(5);
    expect(result[result.length - 1]).toBe('line 199');
  });
});

// ─── startAgent ──────────────────────────────────────────────────────────────

describe('startAgent', () => {
  beforeEach(() => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle', pid: null } }));
  });

  test('spawns child process and returns pid', () => {
    const child = makeChild(5678);
    cp.spawn.mockReturnValue(child);
    const pid = agentsModule.startAgent(ROOT, STATUS_FILE, 'mali', 'status');
    expect(pid).toBe(5678);
    expect(cp.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([expect.stringContaining('mali'), '--action', 'status']),
      expect.objectContaining({ cwd: ROOT })
    );
  });

  test('updates status to idle on child close code 0', () => {
    const child = makeChild(5678);
    cp.spawn.mockReturnValue(child);
    fs.readFileSync
      .mockReturnValueOnce(JSON.stringify({ mali: { status: 'idle', pid: null } })) // readStatus in startAgent
      .mockReturnValueOnce(JSON.stringify({ mali: { status: 'running', pid: 5678 } })); // readStatus in close handler

    agentsModule.startAgent(ROOT, STATUS_FILE, 'mali', 'status');
    child.emit('close', 0);
    expect(fs.writeFileSync).toHaveBeenCalled();
    const written = JSON.parse(fs.writeFileSync.mock.calls.at(-1)[1]);
    expect(written.mali.status).toBe('idle');
  });

  test('updates status to error on non-zero exit', () => {
    const child = makeChild(5678);
    cp.spawn.mockReturnValue(child);
    fs.readFileSync
      .mockReturnValueOnce(JSON.stringify({ mali: { status: 'idle', pid: null } }))
      .mockReturnValueOnce(JSON.stringify({ mali: { status: 'running', pid: 5678 } }));

    agentsModule.startAgent(ROOT, STATUS_FILE, 'mali', 'status');
    child.emit('close', 1);
    const written = JSON.parse(fs.writeFileSync.mock.calls.at(-1)[1]);
    expect(written.mali.status).toBe('error');
  });

  test('kills existing process before starting new one', () => {
    const old = makeChild(1111);
    cp.spawn.mockReturnValueOnce(old);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle', pid: null } }));
    agentsModule.startAgent(ROOT, STATUS_FILE, 'mali', 'status');

    const fresh = makeChild(2222);
    cp.spawn.mockReturnValueOnce(fresh);
    agentsModule.startAgent(ROOT, STATUS_FILE, 'mali', 'status');
    expect(old.kill).toHaveBeenCalled();
  });
});

// ─── stopAgent ───────────────────────────────────────────────────────────────

describe('stopAgent', () => {
  test('kills running process and writes idle status', () => {
    const child = makeChild(9999);
    cp.spawn.mockReturnValue(child);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'running', pid: 9999 } }));

    agentsModule.startAgent(ROOT, STATUS_FILE, 'mali', 'status');
    agentsModule.stopAgent(ROOT, STATUS_FILE, 'mali');
    expect(child.kill).toHaveBeenCalled();
    const written = JSON.parse(fs.writeFileSync.mock.calls.at(-1)[1]);
    expect(written.mali.status).toBe('idle');
    expect(written.mali.pid).toBeNull();
  });
});

// ─── spawnStep ───────────────────────────────────────────────────────────────

describe('spawnStep', () => {
  test('resolves with elapsed time on exit 0', async () => {
    const child = makeChild(7777);
    cp.spawn.mockReturnValue(child);
    const promise = agentsModule.spawnStep('/script.js', [], '/cwd');
    child.stdout.emit('data', Buffer.from('hello'));
    child.emit('close', 0);
    const elapsed = await promise;
    expect(parseFloat(elapsed)).toBeGreaterThanOrEqual(0);
  });

  test('rejects with code on non-zero exit', async () => {
    const child = makeChild(7778);
    cp.spawn.mockReturnValue(child);
    const promise = agentsModule.spawnStep('/script.js', [], '/cwd');
    child.emit('close', 2);
    await expect(promise).rejects.toMatchObject({ code: 2 });
  });

  test('rejects on spawn error', async () => {
    const child = makeChild(7779);
    cp.spawn.mockReturnValue(child);
    const promise = agentsModule.spawnStep('/script.js', [], '/cwd');
    child.emit('error', new Error('ENOENT'));
    await expect(promise).rejects.toMatchObject({ code: -1 });
  });
});

// ─── pipelineStatus getter/setter ────────────────────────────────────────────

describe('pipelineStatus', () => {
  test('starts null and can be set', () => {
    expect(agentsModule.pipelineStatus).toBeNull();
    agentsModule.pipelineStatus = { running: true };
    expect(agentsModule.pipelineStatus).toEqual({ running: true });
    agentsModule.pipelineStatus = null;
  });
});

// ─── runPipelineSequential ───────────────────────────────────────────────────

describe('runPipelineSequential', () => {
  const AI_DIR = '/ai';

  function makePipeChild(exitCode = 0) {
    const c = makeChild(8000 + Math.floor(Math.random() * 1000));
    // Trigger close after next tick so the promise chain can proceed
    const origEmit = c.emit.bind(c);
    c.scheduleClose = (code) => setTimeout(() => origEmit('close', code), 0);
    return c;
  }

  test('runs full pipeline and sets running=false on completion', async () => {
    // skip all optional steps by passing no-post arg, run only scrape
    // provide a child for each spawn call
    const children = Array.from({ length: 5 }, (_, i) => makeChild(9000 + i));
    let spawnIdx = 0;
    cp.spawn.mockImplementation(() => {
      const c = children[spawnIdx++];
      setTimeout(() => c.emit('close', 0), 0);
      return c;
    });

    const promise = agentsModule.runPipelineSequential([], AI_DIR);
    await promise;
    expect(agentsModule.pipelineStatus).not.toBeNull();
    expect(agentsModule.pipelineStatus.running).toBe(false);
  });

  test('skips steps when --no-scrape flag is passed', async () => {
    const children = Array.from({ length: 4 }, (_, i) => makeChild(9100 + i));
    let spawnIdx = 0;
    cp.spawn.mockImplementation(() => {
      const c = children[spawnIdx++];
      setTimeout(() => c.emit('close', 0), 0);
      return c;
    });

    await agentsModule.runPipelineSequential(['--no-scrape'], AI_DIR);
    const steps = agentsModule.pipelineStatus.steps;
    const scrapeStep = steps.find(s => s.id === 'scrape');
    expect(scrapeStep.status).toBe('skipped');
  });

  test('marks subsequent steps as skipped when a step errors', async () => {
    let spawnIdx = 0;
    cp.spawn.mockImplementation(() => {
      const c = makeChild(9200 + spawnIdx++);
      setTimeout(() => c.emit('close', spawnIdx === 1 ? 1 : 0), 0); // first step fails
      return c;
    });

    await agentsModule.runPipelineSequential([], AI_DIR);
    const steps = agentsModule.pipelineStatus.steps;
    const errStep = steps.find(s => s.status === 'error');
    expect(errStep).toBeDefined();
    const skippedAfter = steps.filter((s, i) => i > steps.indexOf(errStep) && s.status === 'skipped');
    expect(skippedAfter.length).toBeGreaterThan(0);
  });

  test('returns early when pipeline is already running', async () => {
    agentsModule.pipelineProcs.pipeline = -1; // mark as running
    const callsBefore = cp.spawn.mock.calls.length;
    await agentsModule.runPipelineSequential([], AI_DIR);
    expect(cp.spawn.mock.calls.length).toBe(callsBefore); // no new spawns
    agentsModule.pipelineProcs.pipeline = null; // reset
  });

  test('appends to pipeline.log on start and finish', async () => {
    cp.spawn.mockImplementation(() => {
      const c = makeChild(9300);
      setTimeout(() => c.emit('close', 0), 0);
      return c;
    });

    await agentsModule.runPipelineSequential([], AI_DIR);
    const appendCalls = fs.appendFileSync.mock.calls.filter(c => String(c[0]).includes('pipeline.log'));
    expect(appendCalls.length).toBeGreaterThan(0);
  });

  test('stdout data appended to pipelineStatus.log when active', async () => {
    cp.spawn.mockImplementation(() => {
      const c = makeChild(9400);
      setTimeout(() => {
        c.stdout.emit('data', 'progress line');
        c.emit('close', 0);
      }, 0);
      return c;
    });

    await agentsModule.runPipelineSequential([], AI_DIR);
    expect(agentsModule.pipelineStatus.log).toContain('progress line');
  });

  test('passes --schedule flag to post step when provided', async () => {
    cp.spawn.mockImplementation(() => {
      const c = makeChild(9500);
      setTimeout(() => c.emit('close', 0), 0);
      return c;
    });

    await agentsModule.runPipelineSequential(['--post', '--schedule'], AI_DIR);
    // post step should have been spawned with --schedule
    const postCall = cp.spawn.mock.calls.find(c => String(c[1]).includes('post.js'));
    expect(postCall).toBeDefined();
    expect(postCall[1]).toContain('--schedule');
  });
});

// ─── startAgent — branch coverage ────────────────────────────────────────────

describe('startAgent — branch coverage', () => {
  beforeEach(() => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ namkhao: { status: 'idle', pid: null } }));
  });

  test('translates start-mali action to approve-today', () => {
    const child = makeChild(6001);
    cp.spawn.mockReturnValue(child);
    agentsModule.startAgent(ROOT, STATUS_FILE, 'namkhao', 'start-mali');
    expect(cp.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--target-action', 'approve-today']),
      expect.any(Object)
    );
  });

  test('translates start-manao action to full', () => {
    const child = makeChild(6002);
    cp.spawn.mockReturnValue(child);
    agentsModule.startAgent(ROOT, STATUS_FILE, 'namkhao', 'start-manao');
    expect(cp.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--target-action', 'full']),
      expect.any(Object)
    );
  });

  test('does NOT update status on close when pid has changed', () => {
    const child = makeChild(6003);
    cp.spawn.mockReturnValue(child);
    // On close, status file shows a different pid (new process took over)
    fs.readFileSync
      .mockReturnValueOnce(JSON.stringify({ namkhao: { status: 'idle', pid: null } }))
      .mockReturnValueOnce(JSON.stringify({ namkhao: { status: 'running', pid: 9999 } })); // different pid

    agentsModule.startAgent(ROOT, STATUS_FILE, 'namkhao', 'status');
    child.emit('close', 0);
    // writeFileSync should NOT have been called for the close handler (pid mismatch)
    const idleWrites = fs.writeFileSync.mock.calls.filter(c =>
      String(c[0]).endsWith('agent-status.json') && String(c[1]).includes('"idle"')
    );
    expect(idleWrites.length).toBe(0);
  });
});

// ─── stopAgent — branch coverage ─────────────────────────────────────────────

describe('stopAgent — branch coverage', () => {
  test('uses pid from status file when no running proc exists', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'running', pid: 4242 } }));
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
    agentsModule.stopAgent(ROOT, STATUS_FILE, 'mali');
    expect(killSpy).toHaveBeenCalledWith(4242);
    killSpy.mockRestore();
  });

  test('handles process.kill throwing gracefully', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'running', pid: 9191 } }));
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    expect(() => agentsModule.stopAgent(ROOT, STATUS_FILE, 'mali')).not.toThrow();
    killSpy.mockRestore();
  });
});

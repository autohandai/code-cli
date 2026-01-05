/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

describe('patch git apply compatibility', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-patch-test-'));
    // Initialize git repo
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('git apply compatibility', () => {
    it('applies a patch for modified file', async () => {
      // 1. Create initial file and commit
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'const x = 1;\n');
      execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

      // 2. Create a patch in git format
      const patch = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;
`;
      await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);

      // 3. Apply patch
      execSync('git apply changes.patch', { cwd: tempDir, stdio: 'pipe' });

      // 4. Verify
      const content = await fs.readFile(path.join(tempDir, 'app.ts'), 'utf-8');
      expect(content).toBe('const x = 2;\n');
    });

    it('applies a patch for new file', async () => {
      // 1. Create initial file and commit
      await fs.writeFile(path.join(tempDir, 'existing.ts'), 'existing\n');
      execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

      // 2. Create a patch for new file
      const patch = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+export function newFunction() {
+  return 'hello';
+}
`;
      await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);

      // 3. Apply patch
      execSync('git apply changes.patch', { cwd: tempDir, stdio: 'pipe' });

      // 4. Verify new file exists
      const content = await fs.readFile(path.join(tempDir, 'new-file.ts'), 'utf-8');
      expect(content).toContain('export function newFunction()');
    });

    it('applies a patch for deleted file', async () => {
      // 1. Create initial file and commit
      await fs.writeFile(path.join(tempDir, 'to-delete.ts'), 'old content\n');
      execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

      // 2. Create a patch for file deletion
      const patch = `diff --git a/to-delete.ts b/to-delete.ts
deleted file mode 100644
--- a/to-delete.ts
+++ /dev/null
@@ -1 +0,0 @@
-old content
`;
      await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);

      // 3. Apply patch
      execSync('git apply changes.patch', { cwd: tempDir, stdio: 'pipe' });

      // 4. Verify file is deleted
      const exists = await fs.pathExists(path.join(tempDir, 'to-delete.ts'));
      expect(exists).toBe(false);
    });

    it('git apply --check validates patch without applying', async () => {
      // 1. Create initial file and commit
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'const x = 1;\n');
      execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

      // 2. Create a valid patch
      const patch = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;
`;
      await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);

      // 3. Check patch (should not throw)
      expect(() => {
        execSync('git apply --check changes.patch', { cwd: tempDir, stdio: 'pipe' });
      }).not.toThrow();

      // 4. File should be unchanged
      const content = await fs.readFile(path.join(tempDir, 'app.ts'), 'utf-8');
      expect(content).toBe('const x = 1;\n');
    });

    it('applies multi-file patch', async () => {
      // 1. Create initial files and commit
      await fs.writeFile(path.join(tempDir, 'file1.ts'), 'content1\n');
      await fs.writeFile(path.join(tempDir, 'file2.ts'), 'content2\n');
      execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

      // 2. Create a multi-file patch
      const patch = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1 +1 @@
-content1
+updated1
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1 +1 @@
-content2
+updated2
`;
      await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);

      // 3. Apply patch
      execSync('git apply changes.patch', { cwd: tempDir, stdio: 'pipe' });

      // 4. Verify both files changed
      const content1 = await fs.readFile(path.join(tempDir, 'file1.ts'), 'utf-8');
      const content2 = await fs.readFile(path.join(tempDir, 'file2.ts'), 'utf-8');
      expect(content1).toBe('updated1\n');
      expect(content2).toBe('updated2\n');
    });

    it('git apply -R reverses a patch', async () => {
      // 1. Create initial file and commit
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'const x = 1;\n');
      execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

      // 2. Create and apply a patch
      const patch = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;
`;
      await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);
      execSync('git apply changes.patch', { cwd: tempDir, stdio: 'pipe' });

      // 3. Verify patch was applied
      let content = await fs.readFile(path.join(tempDir, 'app.ts'), 'utf-8');
      expect(content).toBe('const x = 2;\n');

      // 4. Reverse the patch
      execSync('git apply -R changes.patch', { cwd: tempDir, stdio: 'pipe' });

      // 5. Verify patch was reversed
      content = await fs.readFile(path.join(tempDir, 'app.ts'), 'utf-8');
      expect(content).toBe('const x = 1;\n');
    });
  });

  describe('patch error handling', () => {
    it('git apply fails on conflicting patch', async () => {
      // 1. Create initial file and commit
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'const x = 1;\n');
      execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

      // 2. Modify the file directly
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'const x = 999;\n');

      // 3. Create a patch based on original content
      const patch = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;
`;
      await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);

      // 4. Apply should fail
      expect(() => {
        execSync('git apply changes.patch', { cwd: tempDir, stdio: 'pipe' });
      }).toThrow();
    });
  });
});

describe('generateUnifiedPatch git compatibility', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-patch-gen-test-'));
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('generated patch is applied correctly by git', async () => {
    const { generateUnifiedPatch } = await import('../src/utils/patch.js');

    // 1. Create initial file and commit
    await fs.ensureDir(path.join(tempDir, 'src'));
    await fs.writeFile(path.join(tempDir, 'src', 'app.ts'), 'const x = 1;\n');
    execSync('git add . && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

    // 2. Generate patch using our function
    const patch = generateUnifiedPatch([{
      id: 'change_1',
      filePath: 'src/app.ts',
      changeType: 'modify',
      originalContent: 'const x = 1;\n',
      proposedContent: 'const x = 2;\n',
      description: 'Update x',
      toolId: 'tool_1',
      toolName: 'write_file'
    }]);

    // 3. Write and apply patch
    await fs.writeFile(path.join(tempDir, 'changes.patch'), patch);
    execSync('git apply changes.patch', { cwd: tempDir, stdio: 'pipe' });

    // 4. Verify change was applied
    const content = await fs.readFile(path.join(tempDir, 'src', 'app.ts'), 'utf-8');
    expect(content).toBe('const x = 2;\n');
  });
});

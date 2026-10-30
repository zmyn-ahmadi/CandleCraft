/// <reference types="vite/client" />
import { invoke } from '@tauri-apps/api/core'
import { blankWorkspace, prepareWorkspace, validateWorkspace, type Workspace } from './model'
import { createSaveQueue } from './saveQueue'

const STORAGE_KEY = 'margin-workspace'
const BACKUP_KEY = 'margin-workspace-backup'
const BACKUP_DAY_KEY = 'margin-workspace-backup-day'
const isTauri = () => '__TAURI_INTERNALS__' in window

export interface LoadedWorkspace { workspace: Workspace; recoveredFromBackup: boolean }

function parseWorkspace(json: string): Workspace {
  return prepareWorkspace(validateWorkspace(JSON.parse(json)))
}

export async function loadWorkspace(): Promise<LoadedWorkspace> {
  if (isTauri()) {
    const result = await invoke<{ data: Workspace | null; recoveredFromBackup: boolean }>('load_workspace')
    return { workspace: prepareWorkspace(validateWorkspace(result.data || blankWorkspace())), recoveredFromBackup: result.recoveredFromBackup }
  }
  const primary = localStorage.getItem(STORAGE_KEY)
  if (!primary) {
    if (import.meta.env.VITE_DEMO) return { workspace: prepareWorkspace((await import('./demoWorkspace')).demoWorkspace()), recoveredFromBackup: false }
    return { workspace: blankWorkspace(), recoveredFromBackup: false }
  }
  try { return { workspace: parseWorkspace(primary), recoveredFromBackup: false } }
  catch {
    const backup = localStorage.getItem(BACKUP_KEY)
    if (backup) return { workspace: parseWorkspace(backup), recoveredFromBackup: true }
    throw new Error('Local workspace is damaged and no browser backup was found. Restore a JSON export before recording new data.')
  }
}

async function persistWorkspace(data: Workspace): Promise<void> {
  if (isTauri()) {
    await invoke('save_workspace', { data })
    return
  }
  const json = JSON.stringify(data)
  const existing = localStorage.getItem(STORAGE_KEY)
  const day = new Date().toISOString().slice(0, 10)
  if (existing && localStorage.getItem(BACKUP_DAY_KEY) !== day) {
    try {
      localStorage.setItem(BACKUP_KEY, existing)
      localStorage.setItem(BACKUP_DAY_KEY, day)
    } catch { /* Browser preview may not have room for a second copy. */ }
  }
  localStorage.setItem(STORAGE_KEY, json)
}

export const saveWorkspace = createSaveQueue(persistWorkspace)

export async function workspaceLocation(): Promise<string> {
  return isTauri() ? invoke<string>('workspace_location') : 'Browser preview · local storage'
}

export async function workspaceBackupLocation(): Promise<string> {
  return isTauri() ? invoke<string>('workspace_backup_location') : 'Browser preview · local storage backup'
}

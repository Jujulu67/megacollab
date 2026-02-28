<template>
	<div class="track-controls-wrapper no-select" :style="wrapperStyles" ref="wrapperRef">
		<div
			v-for="([id, track], index) in sortedTracks"
			:key="id"
			class="track-controls"
			@contextmenu.prevent="openContextMenu($event, id)"
			:class="{
				active: contextMenuTrackId === id,
				'is-muted': mutedTrackIds.has(id),
				'is-dragging-track': reorderState?.draggedId === id,
			}"
			:style="trackControlStyle(id, track)"
			@pointerdown="startReorder($event, id, index)"
			@pointerenter="hoveredTrackId = id"
			@pointerleave="hoveredTrackId === id && (hoveredTrackId = null)"
		>
			<!-- drop indicator -->
			<div
				v-if="
					reorderState &&
					reorderState.insertAtIndex === index &&
					reorderState.draggedId !== id
				"
				class="reorder-indicator top"
			></div>

			<div
				class="track-title-row"
				@dblclick.stop="startRename(id, track.title || `Track ${index + 1}`)"
				@auxclick.stop="onMiddleClick($event, id)"
			>
				<template v-if="renamingTrackId === id">
					<input
						ref="renameInput"
						class="rename-input small track-title"
						v-model="renameValue"
						@blur="commitRename(id)"
						@keydown.enter="($event.target as HTMLInputElement)?.blur()"
						@keydown.escape="cancelRename"
						@click.stop
						@pointerdown.stop
					/>
				</template>
				<template v-else>
					<p v-if="track.title" class="small no-select track-title">{{ track.title }}</p>
					<p v-else class="small dim track-title no-select">Track {{ index + 1 }}</p>
				</template>
			</div>

			<div class="track-actions-row" style="grid-area: actions" @pointerdown.stop>
				<button
					class="menu-trigger-btn"
					@click.stop.prevent="toggleContextMenu($event, id)"
					:class="{ active: contextMenuTrackId === id }"
				>
					<Ellipsis :size="16" />
				</button>
				<div class="sm-buttons">
					<button
						class="sm-btn"
						:class="{ active: soloTrackIds.has(id) }"
						@click.stop="toggleSolo(id)"
						title="Solo"
					>
						S
					</button>
					<button
						class="sm-btn mute"
						:class="{ active: mutedTrackIds.has(id) }"
						@click.stop="toggleMute(id)"
						title="Mute"
					>
						M
					</button>
				</div>
			</div>

			<UseElementBounding v-slot="{ top, height }" style="grid-area: vol">
				<div
					class="volumeSlider"
					:class="{
						'is-sidechain-source': track.sidechain_is_source,
						'is-sidechain-receiver': !!track.sidechain_source_track_id,
					}"
					@pointerdown.stop="startVolumeDrag($event, id, top, height)"
					@click.stop
					@contextmenu.prevent.stop="resetVolume(id)"
				>
					<div
						class="volume-meter-fill"
						:style="{
							height: `${(trackVolumes.get(id) ?? 0) * 100}%`,
						}"
					></div>
					<div
						class="volume-thumb"
						:style="{
							bottom: `${track.gain * 50}%`,
						}"
					></div>
					<div class="volume-zero-marker"></div>
				</div>
			</UseElementBounding>

			<!-- context menu -->
			<Teleport to="body">
				<div
					v-if="contextMenuTrackId === id"
					v-on-click-outside="closeContextMenuOutside"
					class="context-menu"
					:style="contextMenuStyles"
					@contextmenu.stop.prevent
					@pointerdown.stop
					@click.stop
				>
					<div class="inner-menu-wrap">
						<div class="menu-header">
							<p
								class="small bold"
								style="
									color: var(--text-color-primary);
									overflow: hidden;
									text-overflow: ellipsis;
									white-space: nowrap;
								"
							>
								{{ track.title || `Track ${index + 1}` }}
							</p>
							<p
								class="small dim mono"
								style="
									overflow: hidden;
									text-overflow: ellipsis;
									white-space: nowrap;
								"
							>
								@{{ track.belongs_to_display_name }}
							</p>
						</div>
						<div
							style="
								border-top: 1px solid var(--border-primary);
								margin-top: 0.5rem;
								padding-bottom: 0.5rem;
							"
						></div>
						<button
							class="default-button menu-btn"
							@click="startRenameFromMenu(id, track.title || `Track ${index + 1}`)"
						>
							<Pencil :size="13" style="color: var(--text-color-secondary)" />
							<p class="small">Rename</p>
						</button>
						<button
							class="default-button menu-btn"
							@mousedown.stop.prevent="openColorPicker(id)"
						>
							<Palette :size="13" style="color: var(--text-color-secondary)" />
							<p class="small">Color</p>
						</button>
						<div
							style="
								border-top: 1px solid var(--border-primary);
								margin-top: 0.3rem;
								padding-bottom: 0.3rem;
							"
						></div>
						<div class="sidechain-menu-section">
							<button
								class="default-button menu-btn sidechain-source-toggle"
								:class="{ active: track.sidechain_is_source }"
								@mousedown="toggleSidechainSource(id)"
							>
								<span
									class="sidechain-source-pill"
									:class="{ active: track.sidechain_is_source }"
								>
									SC
								</span>
								<p class="small">Sidechain Source</p>
							</button>
							<button
								class="default-button menu-btn"
								:class="{
									'sidechain-receive-toggle active':
										!!track.sidechain_source_track_id,
								}"
								@mousedown="openSidechainEditor(id)"
							>
								<span
									class="sidechain-receive-pill"
									:class="{ active: !!track.sidechain_source_track_id }"
								>
									RX
								</span>
								<p class="small">
									{{
										track.sidechain_source_track_id
											? 'Receive Sidechain'
											: 'Get Sidechain'
									}}
								</p>
							</button>
						</div>
						<div
							v-if="sidechainEditorTrackId === id"
							class="sidechain-editor-panel"
							@contextmenu.stop.prevent
							@pointerdown.stop
							@click.stop
						>
							<div class="sidechain-editor-header">
								<p class="small bold">Receive Sidechain</p>
								<button
									class="sidechain-close-btn"
									@mousedown="closeSidechainEditor"
								>
									×
								</button>
							</div>
							<div
								class="sidechain-graph-wrap"
								@pointerdown="startSidechainShapeDrag($event, id)"
							>
								<svg
									viewBox="0 0 100 100"
									class="sidechain-graph"
									preserveAspectRatio="none"
								>
									<defs>
										<linearGradient
											id="scSourceFill"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop
												offset="0%"
												stop-color="#b86a1d"
												stop-opacity="0.85"
											/>
											<stop
												offset="100%"
												stop-color="#b86a1d"
												stop-opacity="0.1"
											/>
										</linearGradient>
									</defs>
									<rect x="0" y="0" width="100" height="100" fill="#0e0f11" />
									<path
										d="M 0 50 L 100 50"
										stroke="rgba(255, 255, 255, 0.13)"
										stroke-width="0.6"
									/>
									<path
										d="M 50 0 L 50 100"
										stroke="rgba(255, 255, 255, 0.12)"
										stroke-width="0.5"
										stroke-dasharray="2 2"
									/>
									<polygon
										:points="getSidechainPreview(id).sourceAreaPoints"
										fill="url(#scSourceFill)"
									/>
									<polyline
										:points="getSidechainPreview(id).receiverPoints"
										stroke="#f3cb2e"
										stroke-width="1.2"
										fill="none"
									/>
									<line
										:x1="getSidechainPreview(id).handleX"
										:y1="0"
										:x2="getSidechainPreview(id).handleX"
										y2="100"
										stroke="rgba(243, 203, 46, 0.35)"
										stroke-width="0.45"
										stroke-dasharray="2 2"
									/>
									<line
										x1="0"
										:y1="getSidechainPreview(id).handleY"
										x2="100"
										:y2="getSidechainPreview(id).handleY"
										stroke="rgba(243, 203, 46, 0.25)"
										stroke-width="0.45"
										stroke-dasharray="2 2"
									/>
								</svg>
								<div
									class="sidechain-handle-dot"
									:style="{
										left: `${getSidechainPreview(id).handleX}%`,
										top: `${getSidechainPreview(id).handleY}%`,
									}"
								></div>
							</div>
							<p class="small dim sidechain-editor-hint">
								Drag in graph:<br />
								left/right = release<br />
								up/down = curve
							</p>
							<div class="sidechain-editor-controls">
								<label class="small dim">Sender</label>
								<select
									class="sidechain-sender-select"
									:value="track.sidechain_source_track_id ?? ''"
									@change="onSidechainSenderChange($event, id)"
								>
									<option value="">None</option>
									<option
										v-for="source in sidechainSourceOptions(id)"
										:key="`${id}_sender_${source.id}`"
										:value="source.id"
									>
										{{ source.label }}
									</option>
								</select>
								<div class="sidechain-mix-row">
									<label class="small dim">
										Mix
										{{
											Math.round(
												clampSidechainMix(track.sidechain_mix) * 100,
											)
										}}%
									</label>
									<input
										class="sidechain-mix-slider"
										type="range"
										min="0"
										max="100"
										step="1"
										:value="
											Math.round(clampSidechainMix(track.sidechain_mix) * 100)
										"
										:disabled="!track.sidechain_source_track_id"
										@pointerdown.stop="rememberSidechainMixStart(id)"
										@input.stop="onSidechainMixInput($event, id)"
										@change.stop="onSidechainMixCommit($event, id)"
									/>
								</div>
								<p class="small dim sidechain-shape-values">
									Curve
									{{ clampSidechainCurve(track.sidechain_curve).toFixed(2) }} •
									Release
									{{
										Math.round(
											clampSidechainReleaseMs(track.sidechain_release_ms),
										)
									}}ms
								</p>
								<button
									v-if="track.sidechain_source_track_id"
									class="default-button menu-btn sidechain-disable-btn"
									@mousedown="disableSidechainReceive(id)"
								>
									<p class="small">Disable Receive</p>
								</button>
							</div>
						</div>
						<div
							style="
								border-top: 1px solid var(--border-primary);
								margin-top: 0.3rem;
								padding-bottom: 0.3rem;
							"
						></div>
						<button
							class="default-button menu-btn"
							@mousedown="insertTrack(index, 'above')"
						>
							<Plus :size="13" style="color: var(--text-color-secondary)" />
							<p class="small">Insert Above</p>
						</button>
						<button
							class="default-button menu-btn"
							@mousedown="insertTrack(index, 'below')"
						>
							<Plus :size="13" style="color: var(--text-color-secondary)" />
							<p class="small">Insert Below</p>
						</button>
						<div
							style="
								border-top: 1px solid var(--border-primary);
								margin-top: 0.3rem;
								padding-bottom: 0.3rem;
							"
						></div>
						<button class="default-button menu-btn delete" @mousedown="deleteTrack(id)">
							<Trash2 :size="13" style="color: var(--text-color-secondary)" />
							<p class="small">Delete Track</p>
						</button>
					</div>
				</div>
			</Teleport>

			<!-- color picker popup -->
			<Teleport to="body">
				<div
					v-if="colorPickTrackId === id"
					v-on-click-outside="() => (colorPickTrackId = null)"
					class="context-menu color-picker-popup"
					:style="colorPickerStyles"
					@contextmenu.stop.prevent
					@pointerdown.stop
					@click.stop
				>
					<div class="inner-menu-wrap">
						<p
							class="small bold"
							style="color: var(--text-color-primary); padding: 0.2rem 0.3rem"
						>
							Track Color
						</p>
						<div class="color-swatches">
							<button
								v-for="color in COLOR_SWATCHES"
								:key="color ?? 'default'"
								class="color-swatch"
								:class="{
									selected: track.color === color,
									'is-default': color === null,
								}"
								:style="{ backgroundColor: color ?? 'var(--bg-color)' }"
								@click="applyColor(id, color)"
							/>
						</div>
						<div
							style="
								border-top: 1px solid var(--border-primary);
								margin-top: 0.4rem;
								padding-top: 0.4rem;
							"
						>
							<label class="custom-color-row">
								<input
									type="color"
									class="inline-color-input"
									:value="track.color || '#000000'"
									@input="onColorChange($event, id)"
								/>
								<span class="small" style="color: var(--text-color-secondary)"
									>Custom…</span
								>
							</label>
						</div>
					</div>
				</div>
			</Teleport>

			<!-- bottom drop indicator -->
			<div
				v-if="
					reorderState &&
					reorderState.insertAtIndex === index + 1 &&
					index === sortedTracks.length - 1
				"
				class="reorder-indicator bottom"
			></div>
		</div>
	</div>
</template>

<script setup lang="ts">
import {
	tracks,
	pxTrackHeight,
	altKeyPressed,
	controlKeyPressed,
	clips,
	user,
	mutedTrackIds,
	soloTrackIds,
	hoveredTrackId,
} from '@/state'
import { computed, reactive, nextTick, watch, type CSSProperties, shallowRef } from 'vue'
import { getTrackVolume, isPlaying, setTrackGain, unregisterTrack } from '@/audioEngine'
import { useRafFn, useEventListener } from '@vueuse/core'
import { UseElementBounding, vOnClickOutside } from '@vueuse/components'
import { socket } from '@/socket/socket'
import { useConsole } from '@/composables/useConsole'
import { Trash2, Ellipsis, Pencil, Palette, Plus } from 'lucide-vue-next'
import { DEFAULT_GAIN } from '~/constants'
import type { Clip, ClientTrack } from '~/schema'

const wrapperStyles = computed((): CSSProperties => {
	return {
		gridAutoRows: `${pxTrackHeight}px`,
	}
})

const sortedTracks = computed(() => {
	return [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
})

const trackLabelById = computed(() => {
	const labels = new Map<string, string>()

	sortedTracks.value.forEach(([id, track], index) => {
		labels.set(id, track.title || `Track ${index + 1}`)
	})

	return labels
})

function getTrackLabel(trackId: string): string {
	return trackLabelById.value.get(trackId) || 'Unknown Track'
}

const SIDECHAIN_MIN_CURVE = 0.35 as const
const SIDECHAIN_MAX_CURVE = 3 as const
const SIDECHAIN_MIN_RELEASE_MS = 40 as const
const SIDECHAIN_MAX_RELEASE_MS = 420 as const
const SIDECHAIN_PREVIEW_POINT_COUNT = 64 as const
const SIDECHAIN_ATTACK_SECONDS = 0.007 as const

function clampSidechainMix(value: number): number {
	return Math.max(0, Math.min(1, value))
}

function clampSidechainCurve(value: number): number {
	return Math.max(SIDECHAIN_MIN_CURVE, Math.min(SIDECHAIN_MAX_CURVE, value))
}

function clampSidechainReleaseMs(value: number): number {
	return Math.max(SIDECHAIN_MIN_RELEASE_MS, Math.min(SIDECHAIN_MAX_RELEASE_MS, value))
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value))
}

function releaseMsToNormX(value: number): number {
	const clamped = clampSidechainReleaseMs(value)
	return (
		(clamped - SIDECHAIN_MIN_RELEASE_MS) / (SIDECHAIN_MAX_RELEASE_MS - SIDECHAIN_MIN_RELEASE_MS)
	)
}

function normXToReleaseMs(value: number): number {
	const clamped = clamp01(value)
	return (
		SIDECHAIN_MIN_RELEASE_MS + clamped * (SIDECHAIN_MAX_RELEASE_MS - SIDECHAIN_MIN_RELEASE_MS)
	)
}

function curveToNormY(value: number): number {
	const clamped = clampSidechainCurve(value)
	return 1 - (clamped - SIDECHAIN_MIN_CURVE) / (SIDECHAIN_MAX_CURVE - SIDECHAIN_MIN_CURVE)
}

function normYToCurve(value: number): number {
	const clamped = clamp01(value)
	return SIDECHAIN_MIN_CURVE + (1 - clamped) * (SIDECHAIN_MAX_CURVE - SIDECHAIN_MIN_CURVE)
}

function sidechainSourceOptions(receiverTrackId: string): { id: string; label: string }[] {
	return sortedTracks.value
		.filter(([id, track]) => id !== receiverTrackId && track.sidechain_is_source)
		.map(([id]) => ({
			id,
			label: getTrackLabel(id),
		}))
}

function toggleSolo(trackId: string) {
	if (soloTrackIds.has(trackId)) soloTrackIds.delete(trackId)
	else soloTrackIds.add(trackId)
}

function toggleMute(trackId: string) {
	if (mutedTrackIds.has(trackId)) mutedTrackIds.delete(trackId)
	else mutedTrackIds.add(trackId)
}

// --- Keyboard Shortcuts ---
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
	if (!hoveredTrackId.value) return
	if ((e.target as HTMLElement)?.tagName === 'INPUT') return

	if (e.key === 's' || e.key === 'S') {
		toggleSolo(hoveredTrackId.value)
		e.preventDefault()
	} else if (e.key === 'm' || e.key === 'M') {
		toggleMute(hoveredTrackId.value)
		e.preventDefault()
	}
})

// --- Track Control Style ---
function trackControlStyle(id: string, track: ClientTrack): CSSProperties {
	const style: CSSProperties = {}
	if (track.color) {
		style.backgroundColor = `color-mix(in lch, ${track.color}, var(--bg-color) 70%)`
	}
	return style
}

// --- Rename Logic ---
const renamingTrackId = shallowRef<string | null>(null)
const renameValue = shallowRef('')

function startRename(trackId: string, currentTitle: string) {
	renamingTrackId.value = trackId
	renameValue.value = currentTitle
	nextTick(() => {
		const inputs = document.querySelectorAll<HTMLInputElement>('.rename-input')
		if (inputs.length) inputs[inputs.length - 1]!.select()
	})
}

function startRenameFromMenu(trackId: string, currentTitle: string) {
	contextMenuTrackId.value = null
	startRename(trackId, currentTitle)
}

function cancelRename() {
	renamingTrackId.value = null
	renameValue.value = ''
}

async function commitRename(trackId: string) {
	const newTitle = renameValue.value.trim() || null
	renamingTrackId.value = null

	const track = tracks.get(trackId)
	if (!track) return

	const oldTitle = track.title
	track.title = newTitle

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { title: newTitle },
	})

	if (!res.success) {
		track.title = oldTitle
		userLog('SYSTEM', `Failed to rename track: ${res.error.message}`, { textColor: 'red' })
	}
}

// --- Color Logic ---
const colorPickTrackId = shallowRef<string | null>(null)
const colorPickerPosition = reactive({ x: 0, y: 0 })

const COLOR_SWATCHES: ReadonlyArray<string | null> = [
	null,
	'#e74c3c',
	'#e67e22',
	'#f1c40f',
	'#2ecc71',
	'#1abc9c',
	'#3498db',
	'#9b59b6',
	'#e91e63',
	'#795548',
	'#607d8b',
	'#00bcd4',
]

const colorPickerStyles = computed(
	(): CSSProperties => ({
		left: `${colorPickerPosition.x}px`,
		top: `${colorPickerPosition.y}px`,
	}),
)

function onMiddleClick(e: MouseEvent, trackId: string) {
	if (e.button !== 1) return
	e.preventDefault()
	if (colorPickTrackId.value === trackId) {
		colorPickTrackId.value = null
	} else {
		openColorPicker(trackId, e)
	}
}

function openColorPicker(trackId: string, event?: MouseEvent) {
	contextMenuTrackId.value = null

	// Position near the track control
	const trackEl = event?.currentTarget as HTMLElement | null
	const rect = trackEl?.closest('.track-controls')?.getBoundingClientRect()
	if (rect) {
		setContextMenuPosition(rect.right + 8, rect.top)
		colorPickerPosition.x = contextMenuPosition.x
		colorPickerPosition.y = contextMenuPosition.y
	} else {
		// Fallback: use the context menu position
		colorPickerPosition.x = contextMenuPosition.x
		colorPickerPosition.y = contextMenuPosition.y
	}

	colorPickTrackId.value = trackId
}

async function updateTrackColor(trackId: string, color: string | null) {
	const track = tracks.get(trackId)
	if (!track) return

	const oldColor = track.color
	track.color = color

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { color },
	})

	if (!res.success) {
		track.color = oldColor
		userLog('SYSTEM', `Failed to change color: ${res.error.message}`, { textColor: 'red' })
	}
}

function applyColor(trackId: string, color: string | null) {
	colorPickTrackId.value = null
	updateTrackColor(trackId, color)
}

function onColorChange(e: Event, trackId: string) {
	const color = (e.target as HTMLInputElement).value
	updateTrackColor(trackId, color)
}

// --- Insert Track ---
async function insertTrack(currentIndex: number, position: 'above' | 'below') {
	contextMenuTrackId.value = null
	if (user.value?.banned_at) return

	const res = await socket.emitWithAck('get:track:create', null)
	if (!res.success) {
		userLog('SYSTEM', `Failed to create track: ${res.error.message}`, { textColor: 'red' })
		return
	}

	const newTrack = res.data
	tracks.set(newTrack.id, newTrack)

	// Reindex: put the new track at the right position
	const sorted = [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
	const insertIdx = position === 'above' ? currentIndex : currentIndex + 1

	// Remove from current pos and insert at new pos
	const idList = sorted.map(([id]) => id).filter((id) => id !== newTrack.id)
	idList.splice(insertIdx, 0, newTrack.id)

	// Assign new order_index values and sync
	for (let i = 0; i < idList.length; i++) {
		const tid = idList[i]!
		const track = tracks.get(tid)
		if (!track || track.order_index === i + 1) continue
		track.order_index = i + 1
		socket.emitWithAck('get:track:update', { id: tid, changes: { order_index: i + 1 } })
	}
}

// --- Drag-to-Reorder ---
const reorderState = shallowRef<{
	draggedId: string
	startY: number
	insertAtIndex: number
} | null>(null)

function startReorder(e: PointerEvent, trackId: string, index: number) {
	if (e.button !== 0) return
	if (renamingTrackId.value) return

	const startY = e.clientY
	let moved = false

	const onMove = (ev: PointerEvent) => {
		if (!moved && Math.abs(ev.clientY - startY) < 5) return
		moved = true

		if (!reorderState.value) {
			reorderState.value = { draggedId: trackId, startY, insertAtIndex: index }
		}

		// Determine where to insert
		const wrapperEl = document.querySelector('.track-controls-wrapper')
		if (!wrapperEl) return

		const trackEls = wrapperEl.querySelectorAll('.track-controls')
		let insertAt = sortedTracks.value.length

		for (let i = 0; i < trackEls.length; i++) {
			const rect = trackEls[i]!.getBoundingClientRect()
			const midY = rect.top + rect.height / 2
			if (ev.clientY < midY) {
				insertAt = i
				break
			}
		}

		reorderState.value = { ...reorderState.value!, insertAtIndex: insertAt }
	}

	const onUp = async () => {
		stopMove()
		stopUp()

		if (!moved || !reorderState.value) {
			reorderState.value = null
			return
		}

		const { draggedId, insertAtIndex } = reorderState.value
		reorderState.value = null

		// Recompute order
		const sorted = sortedTracks.value.map(([id]) => id)
		const fromIdx = sorted.indexOf(draggedId)
		if (fromIdx === -1) return

		sorted.splice(fromIdx, 1)
		const targetIdx = insertAtIndex > fromIdx ? insertAtIndex - 1 : insertAtIndex
		sorted.splice(targetIdx, 0, draggedId)

		for (let i = 0; i < sorted.length; i++) {
			const tid = sorted[i]!
			const track = tracks.get(tid)
			if (!track || track.order_index === i + 1) continue
			track.order_index = i + 1
			socket.emitWithAck('get:track:update', { id: tid, changes: { order_index: i + 1 } })
		}
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onUp)
}

const trackVolumes = reactive(new Map<string, number>())
const { userLog } = useConsole()

const DECAY_RATE = 0.15 as const // Lower = slower decay, higher = faster decay (0-1)

const { pause, resume } = useRafFn(
	() => {
		for (const id of tracks.keys()) {
			const currentVol = getTrackVolume(id)
			const prevVol = trackVolumes.get(id) ?? 0

			// Instant rise, smooth decay
			const newVol =
				currentVol >= prevVol ? currentVol : prevVol - (prevVol - currentVol) * DECAY_RATE
			trackVolumes.set(id, Math.max(0, newVol))
		}
	},
	{ fpsLimit: 30, immediate: isPlaying.value },
)

watch(isPlaying, (playing) => {
	if (playing) {
		resume()
	} else {
		pause()
		for (const id of tracks.keys()) {
			trackVolumes.set(id, 0)
		}
	}
})

// --- Context Menu Logic ---
const contextMenuTrackId = shallowRef<string | null>(null)
const contextMenuPosition = reactive({ x: 0, y: 0 })

const CONTEXT_MENU_WIDTH_PX = 224 as const
const CONTEXT_MENU_ESTIMATED_HEIGHT_PX = 320 as const
const CONTEXT_MENU_VIEWPORT_MARGIN_PX = 8 as const

const contextMenuStyles = computed((): CSSProperties => {
	return {
		left: `${contextMenuPosition.x}px`,
		top: `${contextMenuPosition.y}px`,
	}
})

function setContextMenuPosition(x: number, y: number) {
	if (typeof window === 'undefined') {
		contextMenuPosition.x = x
		contextMenuPosition.y = y
		return
	}

	const maxX = Math.max(
		CONTEXT_MENU_VIEWPORT_MARGIN_PX,
		window.innerWidth - CONTEXT_MENU_WIDTH_PX - CONTEXT_MENU_VIEWPORT_MARGIN_PX,
	)
	const maxY = Math.max(
		CONTEXT_MENU_VIEWPORT_MARGIN_PX,
		window.innerHeight - CONTEXT_MENU_ESTIMATED_HEIGHT_PX - CONTEXT_MENU_VIEWPORT_MARGIN_PX,
	)

	contextMenuPosition.x = Math.min(Math.max(CONTEXT_MENU_VIEWPORT_MARGIN_PX, x), maxX)
	contextMenuPosition.y = Math.min(Math.max(CONTEXT_MENU_VIEWPORT_MARGIN_PX, y), maxY)
}

function openContextMenu(e: MouseEvent, trackId: string) {
	setContextMenuPosition(e.clientX + 8, e.clientY + 8)
	contextMenuTrackId.value = trackId
}

let lastOutsideClose = { time: 0, trackId: '' }

function toggleContextMenu(e: MouseEvent, trackId: string) {
	// v-on-click-outside uses capture phase (pointerdown) and fires BEFORE this click handler.
	// If outside-click just closed THIS track's menu, skip to avoid immediately reopening it.
	if (lastOutsideClose.trackId === trackId && Date.now() - lastOutsideClose.time < 200) return

	if (contextMenuTrackId.value === trackId) {
		contextMenuTrackId.value = null
	} else {
		const trigger = e.currentTarget as HTMLElement | null
		const rect = trigger?.getBoundingClientRect()
		if (rect) {
			const spaceRight = window.innerWidth - rect.right
			const preferredX =
				spaceRight >= CONTEXT_MENU_WIDTH_PX + CONTEXT_MENU_VIEWPORT_MARGIN_PX
					? rect.right + 8
					: rect.left - CONTEXT_MENU_WIDTH_PX - 8
			setContextMenuPosition(preferredX, rect.top)
		} else {
			setContextMenuPosition(e.clientX + 8, e.clientY + 8)
		}
		contextMenuTrackId.value = trackId
	}
}

type SidechainTrackChanges = Pick<
	ClientTrack,
	| 'sidechain_is_source'
	| 'sidechain_source_track_id'
	| 'sidechain_mix'
	| 'sidechain_curve'
	| 'sidechain_release_ms'
>

type SidechainPreview = {
	sourceAreaPoints: string
	receiverPoints: string
	handleX: number
	handleY: number
}

const emptySidechainPreview: SidechainPreview = {
	sourceAreaPoints: '0,90 100,90 100,90',
	receiverPoints: '0,15 100,15',
	handleX: 50,
	handleY: 50,
}

const sidechainEditorTrackId = shallowRef<string | null>(null)

function openSidechainEditor(trackId: string) {
	sidechainEditorTrackId.value = sidechainEditorTrackId.value === trackId ? null : trackId
}

function closeSidechainEditor() {
	sidechainEditorTrackId.value = null
}

watch(contextMenuTrackId, (trackId) => {
	if (!trackId) {
		sidechainEditorTrackId.value = null
		return
	}

	if (sidechainEditorTrackId.value && sidechainEditorTrackId.value !== trackId) {
		sidechainEditorTrackId.value = null
	}
})

function buildSidechainPreview(track: ClientTrack): SidechainPreview {
	const mix = clampSidechainMix(track.sidechain_mix)
	const curve = clampSidechainCurve(track.sidechain_curve)
	const releaseMs = clampSidechainReleaseMs(track.sidechain_release_ms)
	const attackCoeff =
		1 - Math.exp(-1 / (SIDECHAIN_ATTACK_SECONDS * SIDECHAIN_PREVIEW_POINT_COUNT))
	const releaseCoeff = 1 - Math.exp(-1 / ((releaseMs / 1000) * SIDECHAIN_PREVIEW_POINT_COUNT))

	const sourceValues: number[] = []
	const receiverValues: number[] = []
	let currentGain = 1

	for (let i = 0; i < SIDECHAIN_PREVIEW_POINT_COUNT; i++) {
		const t = i / (SIDECHAIN_PREVIEW_POINT_COUNT - 1)
		const sourceEnvelope = Math.exp(-t * 8.5) * (1 - Math.exp(-t * 60))
		sourceValues.push(sourceEnvelope)

		const shapedSource = Math.pow(sourceEnvelope, curve)
		const targetGain = 1 - shapedSource * mix
		const coeff = targetGain < currentGain ? attackCoeff : releaseCoeff
		currentGain += (targetGain - currentGain) * coeff
		receiverValues.push(currentGain)
	}

	const sourceAreaPoints = [
		'0,90',
		...sourceValues.map((value, index) => {
			const x = (index / (SIDECHAIN_PREVIEW_POINT_COUNT - 1)) * 100
			const y = 90 - value * 52
			return `${x.toFixed(2)},${y.toFixed(2)}`
		}),
		'100,90',
	].join(' ')

	const receiverPoints = receiverValues
		.map((value, index) => {
			const x = (index / (SIDECHAIN_PREVIEW_POINT_COUNT - 1)) * 100
			const y = 92 - value * 78
			return `${x.toFixed(2)},${y.toFixed(2)}`
		})
		.join(' ')

	return {
		sourceAreaPoints,
		receiverPoints,
		handleX: releaseMsToNormX(releaseMs) * 100,
		handleY: curveToNormY(curve) * 100,
	}
}

const sidechainPreviewByTrackId = computed(() => {
	const previewMap = new Map<string, SidechainPreview>()

	for (const [id, track] of sortedTracks.value) {
		previewMap.set(id, buildSidechainPreview(track))
	}

	return previewMap
})

function getSidechainPreview(trackId: string): SidechainPreview {
	return sidechainPreviewByTrackId.value.get(trackId) ?? emptySidechainPreview
}

async function persistTrackSidechainChanges(
	trackId: string,
	changes: Partial<SidechainTrackChanges>,
	errorContext: string,
	previousValues?: Partial<SidechainTrackChanges>,
): Promise<boolean> {
	const track = tracks.get(trackId)
	if (!track) return false

	const rollback: Partial<SidechainTrackChanges> = previousValues ?? {
		sidechain_is_source: track.sidechain_is_source,
		sidechain_source_track_id: track.sidechain_source_track_id,
		sidechain_mix: track.sidechain_mix,
		sidechain_curve: track.sidechain_curve,
		sidechain_release_ms: track.sidechain_release_ms,
	}

	Object.assign(track, changes)

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes,
	})

	if (!res.success) {
		Object.assign(track, rollback)
		userLog('SYSTEM', `Failed to ${errorContext}: ${res.error.message}`, {
			textColor: 'red',
		})
		return false
	}

	return true
}

async function toggleSidechainSource(trackId: string) {
	if (user.value?.banned_at) return

	const track = tracks.get(trackId)
	if (!track) return

	const nextIsSource = !track.sidechain_is_source
	const previousIsSource = track.sidechain_is_source
	const updated = await persistTrackSidechainChanges(
		trackId,
		{
			sidechain_is_source: nextIsSource,
		},
		'update sidechain source',
	)
	if (!updated) return

	// If a source gets disabled, clear receivers that were pointing to it.
	if (previousIsSource && !nextIsSource) {
		const receivers = [...tracks.values()].filter(
			(t) => t.sidechain_source_track_id === trackId,
		)
		for (const receiver of receivers) {
			await persistTrackSidechainChanges(
				receiver.id,
				{ sidechain_source_track_id: null },
				'disable sidechain receive',
			)
		}
	}
}

async function setSidechainReceive(trackId: string, sourceTrackId: string) {
	if (user.value?.banned_at) return
	if (trackId === sourceTrackId) return

	const sourceTrack = tracks.get(sourceTrackId)
	if (!sourceTrack?.sidechain_is_source) {
		userLog('SYSTEM', 'Selected sidechain source is not available.', { textColor: 'yellow' })
		return
	}

	await persistTrackSidechainChanges(
		trackId,
		{
			sidechain_source_track_id: sourceTrackId,
		},
		'set sidechain receive source',
	)
}

async function onSidechainSenderChange(event: Event, trackId: string) {
	const selectedSourceTrackId = (event.target as HTMLSelectElement).value || null

	if (!selectedSourceTrackId) {
		await disableSidechainReceive(trackId)
		return
	}

	await setSidechainReceive(trackId, selectedSourceTrackId)
}

async function disableSidechainReceive(trackId: string) {
	if (user.value?.banned_at) return
	await persistTrackSidechainChanges(
		trackId,
		{
			sidechain_source_track_id: null,
		},
		'disable sidechain receive',
	)
}

const sidechainShapeDragStart = reactive(new Map<string, { curve: number; releaseMs: number }>())

function updateSidechainShapeFromPointer(
	trackId: string,
	clientX: number,
	clientY: number,
	graphRect: DOMRect,
) {
	const track = tracks.get(trackId)
	if (!track) return

	const xNorm = clamp01((clientX - graphRect.left) / Math.max(1, graphRect.width))
	const yNorm = clamp01((clientY - graphRect.top) / Math.max(1, graphRect.height))

	track.sidechain_release_ms = normXToReleaseMs(xNorm)
	track.sidechain_curve = normYToCurve(yNorm)
}

function startSidechainShapeDrag(event: PointerEvent, trackId: string) {
	if (user.value?.banned_at) return
	if (event.button !== 0) return

	const graphEl = event.currentTarget as HTMLElement
	const track = tracks.get(trackId)
	if (!track) return

	sidechainShapeDragStart.set(trackId, {
		curve: clampSidechainCurve(track.sidechain_curve),
		releaseMs: clampSidechainReleaseMs(track.sidechain_release_ms),
	})

	updateSidechainShapeFromPointer(
		trackId,
		event.clientX,
		event.clientY,
		graphEl.getBoundingClientRect(),
	)

	let completed = false

	const onMove = (moveEvent: PointerEvent) => {
		updateSidechainShapeFromPointer(
			trackId,
			moveEvent.clientX,
			moveEvent.clientY,
			graphEl.getBoundingClientRect(),
		)
	}

	const onEnd = async () => {
		if (completed) return
		completed = true

		stopMove()
		stopUp()
		stopCancel()

		const currentTrack = tracks.get(trackId)
		const initial = sidechainShapeDragStart.get(trackId)
		if (!currentTrack || !initial) return

		const nextCurve = clampSidechainCurve(currentTrack.sidechain_curve)
		const nextReleaseMs = clampSidechainReleaseMs(currentTrack.sidechain_release_ms)
		currentTrack.sidechain_curve = nextCurve
		currentTrack.sidechain_release_ms = nextReleaseMs

		await persistTrackSidechainChanges(
			trackId,
			{
				sidechain_curve: nextCurve,
				sidechain_release_ms: nextReleaseMs,
			},
			'update sidechain curve',
			{
				sidechain_curve: initial.curve,
				sidechain_release_ms: initial.releaseMs,
			},
		)
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onEnd)
	const stopCancel = useEventListener(window, 'pointercancel', onEnd)
}

const sidechainMixDragStart = reactive(new Map<string, number>())

function rememberSidechainMixStart(trackId: string) {
	const track = tracks.get(trackId)
	if (!track) return
	sidechainMixDragStart.set(trackId, clampSidechainMix(track.sidechain_mix))
}

function onSidechainMixInput(event: Event, trackId: string) {
	const track = tracks.get(trackId)
	if (!track) return

	const raw = Number((event.target as HTMLInputElement).value)
	track.sidechain_mix = clampSidechainMix(raw / 100)
}

async function onSidechainMixCommit(event: Event, trackId: string) {
	if (user.value?.banned_at) return
	const track = tracks.get(trackId)
	if (!track) return

	const raw = Number((event.target as HTMLInputElement).value)
	const nextMix = clampSidechainMix(raw / 100)
	const previousMix = sidechainMixDragStart.get(trackId) ?? track.sidechain_mix

	track.sidechain_mix = nextMix

	const updated = await persistTrackSidechainChanges(
		trackId,
		{
			sidechain_mix: nextMix,
		},
		'update sidechain mix',
		{
			sidechain_mix: previousMix,
		},
	)

	if (updated) {
		sidechainMixDragStart.set(trackId, nextMix)
	}
}

function closeContextMenuOutside() {
	lastOutsideClose = { time: Date.now(), trackId: contextMenuTrackId.value ?? '' }
	contextMenuTrackId.value = null
}

async function deleteTrack(trackId: string) {
	if (user.value?.banned_at) return
	contextMenuTrackId.value = null
	if (sidechainEditorTrackId.value === trackId) sidechainEditorTrackId.value = null

	const track = tracks.get(trackId)
	if (!track) return

	const clipsToDelete: Clip[] = []
	const previousReceiverSources = new Map<string, string | null>()

	for (const [_, clip] of clips.entries()) {
		if (clip.track_id === trackId) clipsToDelete.push(clip)
	}

	for (const receiver of tracks.values()) {
		if (receiver.sidechain_source_track_id !== trackId) continue
		previousReceiverSources.set(receiver.id, receiver.sidechain_source_track_id)
		receiver.sidechain_source_track_id = null
	}

	clipsToDelete.forEach((clip) => clips.delete(clip.id))

	const optimisticTrack = { ...track }

	unregisterTrack(trackId)
	tracks.delete(trackId)

	const res = await socket.emitWithAck('get:track:delete', { id: trackId })

	if (!res.success) {
		tracks.set(trackId, optimisticTrack)

		clipsToDelete.forEach((clip) => clips.set(clip.id, clip))
		for (const [receiverTrackId, previousSource] of previousReceiverSources) {
			const receiverTrack = tracks.get(receiverTrackId)
			if (!receiverTrack) continue
			receiverTrack.sidechain_source_track_id = previousSource
		}

		userLog('SYSTEM', `Failed to delete track: ${res.error.message}`, {
			textColor: 'red',
			isBold: true,
		})
	}
}

function startVolumeDrag(e: PointerEvent, trackId: string, top: number, height: number) {
	if (user.value?.banned_at) return
	if (e.button !== 0) return

	const target = e.currentTarget as HTMLElement
	target.setPointerCapture(e.pointerId)

	const track = tracks.get(trackId)
	if (!track) {
		userLog('SYSTEM', 'This track has been deleted.', {
			textColor: 'yellow',
		})
		return
	}
	const initialGain = track.gain

	const SENSITIVITY = 0.2

	const range = 2
	const min = 0

	const startY = e.clientY
	let currentClientY = e.clientY
	const startRelativeY = Math.max(0, Math.min(1, 1 - (e.clientY - top) / height))

	function update(clientY: number) {
		const deltaY = startY - clientY
		const relativeDelta = (deltaY / height) * SENSITIVITY
		const relativeY = Math.max(0, Math.min(1, startRelativeY + relativeDelta))

		let gain: number = min + relativeY * range

		if (altKeyPressed.value || controlKeyPressed.value) {
			gain = 1
		}

		// update local state optimistically
		const track = tracks.get(trackId)

		if (track) {
			track.gain = gain
			setTrackGain(trackId, gain)
		}
	}

	// Initial click update
	update(currentClientY)

	function onMove(e: PointerEvent) {
		currentClientY = e.clientY
		update(currentClientY)
	}

	const { stop: stopKeys } = watch([altKeyPressed, controlKeyPressed], () => {
		update(currentClientY)
	})

	async function onEnd() {
		// Cleanup listeners
		stopMove()
		stopUp()
		stopLostCapture()
		stopKeys()

		if (target.hasPointerCapture(e.pointerId)) {
			target.releasePointerCapture(e.pointerId)
		}

		// Final sync
		const track = tracks.get(trackId)
		if (track) {
			const res = await socket.emitWithAck('get:track:update', {
				id: trackId,
				changes: { gain: track.gain },
			})

			if (!res.success) {
				track.gain = initialGain
				setTrackGain(trackId, initialGain)
				userLog('SYSTEM', `Failed to update track gain: ${res.error.message}`, {
					textColor: 'red',
				})
			}
		}
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onEnd)
	const stopLostCapture = useEventListener(target, 'lostpointercapture', onEnd)
}

async function resetVolume(trackId: string) {
	if (user.value?.banned_at) return
	const track = tracks.get(trackId)
	if (!track) return

	const initialGain = track.gain
	const newGain = DEFAULT_GAIN

	track.gain = newGain // todo: this should be done automatically by settrackgain
	setTrackGain(trackId, newGain)

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { gain: newGain },
	})

	if (!res.success) {
		// Revert
		track.gain = initialGain
		setTrackGain(trackId, initialGain)
		userLog('SYSTEM', `Failed to reset track gain: ${res.error.message}`, {
			textColor: 'yellow',
		})
	}
}
</script>

<style scoped>
.track-controls-wrapper {
	display: grid;
	grid-auto-rows: auto;
	position: sticky;
	left: 0;
	z-index: 100;

	padding-top: 2rem;
}

.track-title {
	font-family:
		inhesystem-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji',
		'Segoe UI Emoji', 'Segoe UI Symbol';
	font-weight: 400;
	font-size: 13px;
	line-height: 140%;
	color: #fff;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.track-controls {
	padding: 0.8rem 1rem;

	color: var(--text-color-primary);

	z-index: 10;

	display: grid;
	grid-template-columns: 1fr auto;
	grid-template-areas: 'title vol' 'actions vol';

	column-gap: 0.2rem;

	width: 11rem;

	border-bottom: 1px solid var(--border-primary);

	box-shadow: 1px 0px 0px 0px var(--border-primary);

	background-color: var(--bg-color);

	position: relative;
}

.track-title-row {
	grid-area: title;
	display: flex;
	align-items: center;
	gap: 0.3rem;
	min-width: 0;
}

.track-title-row .track-title {
	flex: 1;
	min-width: 0;
}

.sm-buttons {
	display: flex;
	gap: 2px;
	flex-shrink: 0;
}

.sm-btn {
	background: transparent;
	border: 1px solid color-mix(in lch, var(--border-primary), white 25%);
	color: #fff;
	font-size: 0.8rem;
	font-weight: 700;
	width: 2rem;
	height: 2rem;
	border-radius: 3px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	line-height: 1;
	transition: all 80ms ease;
}

.track-actions-row {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	margin-top: auto;
}

.color-picker-popup {
	width: 13rem;
}

.color-swatches {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 6px;
	padding: 0.3rem;
}

.color-swatch {
	width: 100%;
	aspect-ratio: 1;
	border-radius: 4px;
	border: 2px solid transparent;
	cursor: pointer;
	transition: all 100ms ease;
	padding: 0;
}

.color-swatch:hover {
	transform: scale(1.15);
	border-color: rgba(255, 255, 255, 0.4);
}

.color-swatch.selected {
	border-color: white;
	box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
}

.color-swatch.is-default {
	border-color: var(--border-primary);
}

.custom-color-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.2rem 0.3rem;
	cursor: pointer;
	border-radius: 4px;
	transition: background-color 100ms ease;
}

.custom-color-row:hover {
	background-color: color-mix(in lch, transparent, white 15%);
}

.inline-color-input {
	width: 1.5rem;
	height: 1.5rem;
	padding: 0;
	border: 1px solid var(--border-primary);
	border-radius: 4px;
	cursor: pointer;
	background: none;
	-webkit-appearance: none;
	appearance: none;
}

.inline-color-input::-webkit-color-swatch-wrapper {
	padding: 1px;
}

.inline-color-input::-webkit-color-swatch {
	border: none;
	border-radius: 3px;
}

.sm-btn:hover {
	background-color: color-mix(in lch, var(--bg-color), white 20%);
}

.sm-btn.active {
	background-color: #e8a620;
	color: #000;
	border-color: #e8a620;
}

.sm-btn.mute.active {
	background-color: #d33;
	color: #fff;
	border-color: #d33;
}

.track-controls.active {
	background-color: color-mix(in lch, var(--bg-color), white 5%);
}

.track-controls:first-child {
	box-shadow: 1px -1px 0px 0px var(--border-primary);
}

.track-controls:last-child {
	border-bottom: none;
}

.volumeSlider {
	position: relative;
	height: 100%;
	width: 1.1rem;
	border: 1px solid transparent;
	border-radius: 0.3rem;
	overflow: hidden;

	background-color: color-mix(in lab, var(--border-primary), black 65%);
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	touch-action: none;
	/* prevent scroll while dragging */
	cursor: ns-resize;
	transition:
		border-color 120ms ease,
		box-shadow 120ms ease;
}

.volumeSlider.is-sidechain-source {
	border-color: color-mix(in lch, #ff5757, black 10%);
	box-shadow:
		0 0 0 1px color-mix(in lch, #ff5757, transparent 72%),
		0 0 0.55rem 0.03rem color-mix(in lch, #ff5757, transparent 78%);
}

.volumeSlider.is-sidechain-receiver {
	border-color: color-mix(in lch, #f3cb2e, black 15%);
	box-shadow:
		0 0 0 1px color-mix(in lch, #f3cb2e, transparent 70%),
		0 0 0.55rem 0.03rem color-mix(in lch, #f3cb2e, transparent 74%);
}

.volumeSlider.is-sidechain-source.is-sidechain-receiver {
	border-color: color-mix(in lch, #f3cb2e 55%, #ff5757 45%);
	box-shadow:
		0 0 0 1px color-mix(in lch, #f3cb2e, transparent 75%),
		0 0 0 2px color-mix(in lch, #ff5757, transparent 84%),
		0 0 0.7rem 0.04rem color-mix(in lch, #f3cb2e, transparent 82%),
		0 0 0.5rem 0.03rem color-mix(in lch, #ff5757, transparent 85%);
}

.volume-meter-fill {
	width: 100%;
	background: linear-gradient(
		to top,
		var(--border-primary) 10px,
		color-mix(in lch, var(--border-primary), white 60%) 69px
	);
	min-height: 0;
	transition: height 0.1s linear;
}

.volume-thumb {
	position: absolute;
	left: 0;
	right: 0;
	height: 1px;
	background-color: white;
	pointer-events: none;
	box-shadow: 0 0 2px black;
}

.volume-zero-marker {
	position: absolute;
	top: 50%;
	left: 0;
	right: 0;
	height: 1px;
	background-color: color-mix(in lch, var(--border-primary), white 20%);
	opacity: 0.5;
	pointer-events: none;
}

/* Context Menu Styles */
.context-menu {
	position: fixed;
	width: 14rem;
	border-radius: 0.75rem;
	display: grid;
	z-index: 220;
}

.inner-menu-wrap {
	display: grid;
	border-radius: inherit;
	padding: 0.5rem;
	width: 100%;
	box-shadow: 0px 0px 1rem 0rem var(--bg-color);
	background-color: color-mix(in lch, var(--bg-color), white 10%);
	border: 1px solid var(--border-primary);
}

.menu-header {
	padding: 0.3rem 0.5rem;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
	max-width: 16rem;
}

.menu-btn {
	background-color: transparent;
	box-shadow: none;
	justify-content: flex-start;
	white-space: nowrap;
	gap: 0.6rem;
	padding-left: 0.6rem;
}

.menu-btn:hover {
	background-color: color-mix(in lch, transparent, white 15%);
	box-shadow: none;
}

.menu-btn.delete {
	color: var(--text-color-primary);
}

.menu-btn.delete:hover {
	background-color: color-mix(in lch, #ff4444, black 20%);
	color: white;
}

.menu-icon-spacer {
	width: 13px;
	height: 13px;
	display: inline-block;
	flex-shrink: 0;
}

.sidechain-menu-section {
	display: grid;
	gap: 0.35rem;
	margin-bottom: 0.3rem;
}

.sidechain-source-toggle.active {
	background-color: color-mix(in lch, #e8a620, transparent 78%);
	box-shadow: 0 0 0.45rem 0.04rem color-mix(in lch, #e8a620, transparent 60%);
}

.sidechain-source-pill {
	width: 1.45rem;
	height: 1.45rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border-radius: 999px;
	font-size: 0.68rem;
	font-weight: 700;
	border: 1px solid var(--border-primary);
	color: var(--text-color-secondary);
	background-color: color-mix(in lch, var(--bg-color), black 30%);
	transition: all 120ms ease;
}

.sidechain-source-pill.active {
	color: #111;
	border-color: #f3cb2e;
	background: radial-gradient(circle at 35% 25%, #f7de66, #e8a620 70%);
	box-shadow: 0 0 0.8rem 0.05rem color-mix(in lch, #f3cb2e, transparent 50%);
}

.sidechain-editor-panel {
	position: absolute;
	left: calc(100% + 0.5rem);
	top: 0;
	width: 18.8rem;
	min-height: 21.2rem;
	border-radius: 0.75rem;
	padding: 0.7rem;
	background: linear-gradient(
		180deg,
		color-mix(in lch, var(--bg-color), white 12%),
		color-mix(in lch, var(--bg-color), black 6%)
	);
	border: 1px solid color-mix(in lch, var(--border-primary), white 15%);
	box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.35);
	display: grid;
	gap: 0.6rem;
	z-index: 120;
}

.sidechain-editor-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.sidechain-close-btn {
	background: transparent;
	border: none;
	color: var(--text-color-secondary);
	font-size: 1rem;
	line-height: 1;
	width: 1.3rem;
	height: 1.3rem;
	cursor: pointer;
	border-radius: 0.3rem;
}

.sidechain-close-btn:hover {
	background-color: color-mix(in lch, transparent, white 14%);
	color: var(--text-color-primary);
}

.sidechain-graph-wrap {
	position: relative;
	border: 1px solid color-mix(in lch, var(--border-primary), white 12%);
	border-radius: 0.45rem;
	overflow: hidden;
	cursor: move;
}

.sidechain-graph {
	display: block;
	width: 100%;
	height: 9.6rem;
}

.sidechain-handle-dot {
	position: absolute;
	width: 0.78rem;
	height: 0.78rem;
	transform: translate(-50%, -50%);
	border-radius: 999px;
	background: #f3cb2e;
	border: 1px solid #111;
	box-shadow:
		0 0 0.7rem 0.04rem color-mix(in lch, #f3cb2e, transparent 52%),
		0 0 0 1px color-mix(in lch, #111, transparent 75%);
	pointer-events: none;
}

.sidechain-editor-hint {
	padding-left: 0.1rem;
}

.sidechain-editor-controls {
	display: grid;
	gap: 0.45rem;
}

.sidechain-sender-select {
	width: 100%;
	background-color: color-mix(in lch, var(--bg-color), black 16%);
	border: 1px solid color-mix(in lch, var(--border-primary), white 8%);
	color: var(--text-color-primary);
	border-radius: 0.35rem;
	padding: 0.48rem 0.58rem;
	font-size: 0.9rem;
	line-height: 1.25;
	min-height: 2.1rem;
}

.sidechain-mix-row {
	display: grid;
	gap: 0.2rem;
}

.sidechain-mix-slider {
	width: 100%;
	accent-color: #f3cb2e;
}

.sidechain-shape-values {
	padding: 0.05rem 0.1rem 0.1rem;
}

.sidechain-disable-btn {
	padding-left: 0.55rem;
	color: var(--text-color-secondary);
}

.sidechain-disable-btn:hover {
	color: var(--text-color-primary);
}

.sidechain-receive-toggle.active {
	background-color: color-mix(in lch, #e8a620, transparent 80%);
	box-shadow: 0 0 0.45rem 0.02rem color-mix(in lch, #e8a620, transparent 62%);
}

.sidechain-receive-pill {
	width: 1.45rem;
	height: 1.45rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border-radius: 999px;
	font-size: 0.66rem;
	font-weight: 700;
	border: 1px solid var(--border-primary);
	color: var(--text-color-secondary);
	background-color: color-mix(in lch, var(--bg-color), black 28%);
	transition: all 120ms ease;
}

.sidechain-receive-pill.active {
	color: #111;
	border-color: #f3cb2e;
	background: radial-gradient(circle at 35% 25%, #f7de66, #e8a620 70%);
	box-shadow: 0 0 0.8rem 0.05rem color-mix(in lch, #f3cb2e, transparent 50%);
}

.menu-trigger-btn {
	background-color: transparent;
	border: 1px solid color-mix(in lch, var(--border-primary), white 25%);
	color: #fff;
	opacity: 1;
	padding: 0;
	border-radius: 3px;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	height: 2rem;
	width: 2rem;
	flex-shrink: 0;
	line-height: 1;
}

.menu-trigger-btn:hover,
.menu-trigger-btn.active {
	background-color: color-mix(in lch, var(--bg-color), white 15%);
	color: var(--text-color-primary);
}

.rename-input {
	background: transparent;
	border: none;
	border-bottom: 1px solid var(--text-color-primary);
	color: var(--text-color-primary);
	outline: none;
	width: 100%;
	padding: 0;
	font-family:
		inhesystem-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji',
		'Segoe UI Emoji', 'Segoe UI Symbol';
	font-size: 13px;
	font-weight: 400;
	line-height: 140%;
	letter-spacing: inherit;
}

.track-controls.is-muted {
	opacity: 0.45;
}

.track-controls.is-dragging-track {
	opacity: 0.4;
}

.reorder-indicator {
	position: absolute;
	left: 0;
	right: 0;
	height: 2px;
	background-color: #e8a620;
	z-index: 20;
	pointer-events: none;
}

.reorder-indicator.top {
	top: -1px;
}

.reorder-indicator.bottom {
	bottom: -1px;
}
</style>

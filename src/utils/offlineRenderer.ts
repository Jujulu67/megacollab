import { clips, audioBuffers, tracks, bpm } from '@/state'
import type { Clip, ClientTrack } from '~/schema'
import { beats_to_sec_pure } from '@/utils/mathUtils'

export type PlaylistSnapshot = {
	clips: Clip[]
	tracks: Map<string, ClientTrack>
	buffers: Map<string, AudioBuffer>
	bpm: number
}

/**
 * Capture a frozen snapshot of the current playlist state.
 * Deep-clones clips and tracks (plain objects).
 * Shallow-copies the audioBuffers Map — AudioBuffer objects are immutable,
 * so the snapshot's reference keeps them alive even if deleted from state mid-render.
 */
function takeSnapshot(): PlaylistSnapshot {
	const clipsSnapshot = Array.from(clips.values()).map((c) => ({ ...c }))
	const tracksSnapshot = new Map(Array.from(tracks.entries()).map(([id, t]) => [id, { ...t }]))
	const buffersSnapshot = new Map(audioBuffers)

	return {
		clips: clipsSnapshot,
		tracks: tracksSnapshot,
		buffers: buffersSnapshot,
		bpm,
	}
}

const SAMPLE_RATE = 44100
const NUM_CHANNELS = 2
const SIDECHAIN_ATTACK_SECONDS = 0.007 as const
const SIDECHAIN_AUTOMATION_STEP_SAMPLES = 128 as const
const SIDECHAIN_MIN_RELEASE_MS = 40 as const
const SIDECHAIN_MAX_RELEASE_MS = 420 as const
const SIDECHAIN_MIN_CURVE = 0.35 as const
const SIDECHAIN_MAX_CURVE = 3 as const

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value))
}

function buildSourceEnvelope(
	snapshot: PlaylistSnapshot,
	sourceTrackId: string,
	totalSamples: number,
): Float32Array {
	const envelope = new Float32Array(totalSamples)
	const sourceTrack = snapshot.tracks.get(sourceTrackId)
	if (!sourceTrack) return envelope

	const sourceTrackGain = Math.max(0, sourceTrack.gain)
	const sourceClips = snapshot.clips.filter(
		(clip) => clip.track_id === sourceTrackId && !clip.muted,
	)

	for (const clip of sourceClips) {
		const buffer = snapshot.buffers.get(clip.audio_file_id)
		if (!buffer) continue

		const left = buffer.getChannelData(0)
		const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
		const clipStartSample = Math.max(
			0,
			Math.floor(beats_to_sec_pure(clip.start_beat, snapshot.bpm) * SAMPLE_RATE),
		)
		const clipDurationSamples = Math.max(
			0,
			Math.floor(
				beats_to_sec_pure(clip.end_beat - clip.start_beat, snapshot.bpm) * SAMPLE_RATE,
			),
		)
		const sourceOffsetSamples = Math.max(0, Math.floor(clip.offset_seconds * buffer.sampleRate))
		const sourceRateRatio = buffer.sampleRate / SAMPLE_RATE

		if (clipDurationSamples <= 0) continue

		for (let i = 0; i < clipDurationSamples; i++) {
			const timelineSampleIndex = clipStartSample + i
			if (timelineSampleIndex >= totalSamples) break

			const sourceSampleIndex = sourceOffsetSamples + Math.floor(i * sourceRateRatio)
			if (sourceSampleIndex >= left.length || sourceSampleIndex >= right.length) break

			const samplePeak = Math.max(
				Math.abs(left[sourceSampleIndex] ?? 0),
				Math.abs(right[sourceSampleIndex] ?? 0),
			)
			const effectivePeak = clamp01(samplePeak * clip.gain * sourceTrackGain)

			if (effectivePeak > envelope[timelineSampleIndex]!) {
				envelope[timelineSampleIndex] = effectivePeak
			}
		}
	}

	return envelope
}

function buildSidechainCurve(
	envelope: Float32Array,
	mix: number,
	curveShape: number,
	releaseMs: number,
): Float32Array {
	const totalSamples = envelope.length
	const pointCount = Math.max(2, Math.ceil(totalSamples / SIDECHAIN_AUTOMATION_STEP_SAMPLES))
	const curve = new Float32Array(pointCount)
	const clampedShape = Math.max(SIDECHAIN_MIN_CURVE, Math.min(SIDECHAIN_MAX_CURVE, curveShape))
	const clampedReleaseMs = Math.max(
		SIDECHAIN_MIN_RELEASE_MS,
		Math.min(SIDECHAIN_MAX_RELEASE_MS, releaseMs),
	)
	const attackCoeff = 1 - Math.exp(-1 / (SIDECHAIN_ATTACK_SECONDS * SAMPLE_RATE))
	const releaseCoeff = 1 - Math.exp(-1 / ((clampedReleaseMs / 1000) * SAMPLE_RATE))

	let current = 1
	let envelopeIndex = 0

	for (let point = 0; point < pointCount; point++) {
		const endSample = Math.min(totalSamples, (point + 1) * SIDECHAIN_AUTOMATION_STEP_SAMPLES)

		while (envelopeIndex < endSample) {
			const sourcePeak = clamp01(envelope[envelopeIndex] ?? 0)
			const shapedPeak = Math.pow(sourcePeak, clampedShape)
			const target = 1 - shapedPeak * mix
			const coeff = target < current ? attackCoeff : releaseCoeff
			current += (target - current) * coeff
			envelopeIndex++
		}

		curve[point] = current
	}

	return curve
}

/**
 * Render the current playlist state offline using OfflineAudioContext.
 * Returns a rendered AudioBuffer ready for encoding.
 */
export async function renderPlaylistOffline(): Promise<AudioBuffer> {
	const snapshot = takeSnapshot()

	if (snapshot.clips.length === 0) {
		throw new Error('No clips to render')
	}

	// Find the latest end beat to determine render duration
	let latestEndBeat = 0
	for (const clip of snapshot.clips) {
		if (clip.end_beat > latestEndBeat) latestEndBeat = clip.end_beat
	}

	const durationSeconds = beats_to_sec_pure(latestEndBeat, snapshot.bpm)
	if (durationSeconds <= 0) {
		throw new Error('Playlist has zero duration')
	}

	const offlineCtx = new OfflineAudioContext(
		NUM_CHANNELS,
		Math.ceil(durationSeconds * SAMPLE_RATE),
		SAMPLE_RATE,
	)
	const totalSamples = Math.ceil(durationSeconds * SAMPLE_RATE)

	// Build per-track input gain and sidechain gain nodes.
	const trackInputGainNodes = new Map<string, GainNode>()
	const trackSidechainGainNodes = new Map<string, GainNode>()
	for (const [trackId, track] of snapshot.tracks) {
		const inputGainNode = offlineCtx.createGain()
		const sidechainGainNode = offlineCtx.createGain()

		inputGainNode.gain.value = track.gain
		sidechainGainNode.gain.value = 1

		inputGainNode.connect(sidechainGainNode)
		sidechainGainNode.connect(offlineCtx.destination)

		trackInputGainNodes.set(trackId, inputGainNode)
		trackSidechainGainNodes.set(trackId, sidechainGainNode)
	}

	// Build source envelopes only for tracks that are actually used as sidechain sources.
	const sourceTrackIds = new Set<string>()
	for (const track of snapshot.tracks.values()) {
		if (!track.sidechain_source_track_id) continue
		if (track.sidechain_mix <= 0) continue

		const sourceTrack = snapshot.tracks.get(track.sidechain_source_track_id)
		if (!sourceTrack?.sidechain_is_source) continue

		sourceTrackIds.add(track.sidechain_source_track_id)
	}

	const sidechainEnvelopes = new Map<string, Float32Array>()
	for (const sourceTrackId of sourceTrackIds) {
		sidechainEnvelopes.set(
			sourceTrackId,
			buildSourceEnvelope(snapshot, sourceTrackId, totalSamples),
		)
	}

	// Apply ducking automation to receiver tracks.
	for (const [trackId, track] of snapshot.tracks) {
		const sourceTrackId = track.sidechain_source_track_id
		if (!sourceTrackId) continue
		if (sourceTrackId === trackId) continue

		const mix = clamp01(track.sidechain_mix)
		if (mix <= 0) continue

		const sourceTrack = snapshot.tracks.get(sourceTrackId)
		if (!sourceTrack?.sidechain_is_source) continue

		const envelope = sidechainEnvelopes.get(sourceTrackId)
		const sidechainGainNode = trackSidechainGainNodes.get(trackId)
		if (!envelope || !sidechainGainNode) continue

		const curve = buildSidechainCurve(
			envelope,
			mix,
			track.sidechain_curve,
			track.sidechain_release_ms,
		)
		sidechainGainNode.gain.setValueCurveAtTime(curve, 0, durationSeconds)
	}

	// Schedule every clip
	for (const clip of snapshot.clips) {
		const buffer = snapshot.buffers.get(clip.audio_file_id)
		const trackInputGainNode = trackInputGainNodes.get(clip.track_id)
		if (!buffer || !trackInputGainNode) continue

		const source = offlineCtx.createBufferSource()
		const clipGainNode = offlineCtx.createGain()

		clipGainNode.gain.value = clip.gain
		source.buffer = buffer
		source.connect(clipGainNode)
		clipGainNode.connect(trackInputGainNode)

		const startTimeSec = beats_to_sec_pure(clip.start_beat, snapshot.bpm)
		const clipDurationSec = beats_to_sec_pure(clip.end_beat - clip.start_beat, snapshot.bpm)

		source.start(startTimeSec, clip.offset_seconds, clipDurationSec)
	}

	return offlineCtx.startRendering()
}

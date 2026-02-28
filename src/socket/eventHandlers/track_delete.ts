import { clips, tracks } from '@/state'
import { setTrackGain, unregisterTrack } from '@/audioEngine'
import { defineSocketHandler } from '@/socket/socket'

export default defineSocketHandler({
	event: 'track:delete',
	handler: ({ track_id, deleted_clips }) => {
		const existing = tracks.get(track_id)
		if (!existing) return

		deleted_clips.forEach((id) => {
			clips.delete(id)
		})

		for (const track of tracks.values()) {
			if (track.sidechain_source_track_id === track_id) {
				track.sidechain_source_track_id = null
			}
		}

		unregisterTrack(track_id)
		tracks.delete(track_id)
	},
})

import { Api, Jellyfin } from "@jellyfin/sdk";
import type { MediaStream } from "@jellyfin/sdk/lib/generated-client/models";
import type { AuthenticationResult } from "@jellyfin/sdk/lib/generated-client/models/authentication-result";
import { getPlaystateApi, getSearchApi, getTvShowsApi, getUserLibraryApi } from "@jellyfin/sdk/lib/utils/api"

export interface Authenticatable {
    authenticate(username: string, password: string): Promise<JellyfinClient>;
}

const jellyfin = new Jellyfin({
    clientInfo: {
        name: 'Jellyfin Subtitle Changer',
        version: '0.0.1',
    },
    deviceInfo: {
        name: 'Jellyfin Subtitle Changer',
        id: 'idk-lolzzzz',
    },
})

export const getServer = async (url: string) => {
    const servers = await jellyfin.discovery.getRecommendedServerCandidates(url)
    const best = jellyfin.discovery.findBestServer(servers)

    if (!best) {
        throw new Error('No available servers found')
    }

    return new JellyfinClient(jellyfin.createApi(best.address)) as Authenticatable
}

export class JellyfinClient {
    private authData: AuthenticationResult = {}
    constructor(private api: Api) { }

    authenticate = async (username: string, password: string) => {
        const auth = await this.api.authenticateUserByName(username, password)

        this.authData = auth.data
        return this as JellyfinClient
    }

    getShows = async (searchTerm: string) => {
        const items = await getSearchApi(this.api).getSearchHints({ searchTerm, includeItemTypes: ["Series"] })

        return items.data.SearchHints
    }

    getSeasons = async (showID: string) => {
        const items = await getTvShowsApi(this.api).getSeasons({ seriesId: showID })

        return items.data.Items
    }

    getEpisodes = async (showID: string, seasonID: string) => {
        const items = await getTvShowsApi(this.api).getEpisodes({ seriesId: showID, seasonId: seasonID })

        return items.data.Items
    }

    getEpisode = async (episodeID: string) => {
        const items = await getUserLibraryApi(this.api).getItem({ itemId: episodeID })

        return items.data
    }

    setEpisodeDefaults = async (episodeID: string, subtitleStream: MediaStream, audioStream: MediaStream): Promise<[boolean, boolean]> => {
        const episode = await this.getEpisode(episodeID)


        const payload = {
            MediaSourceId: episodeID,
            ItemId: episodeID,
            SubtitleStreamIndex: episode.MediaSources![0].DefaultSubtitleStreamIndex,
            AudioStreamIndex: episode.MediaSources![0].DefaultAudioStreamIndex,
            PositionTicks: episode.UserData!.PlaybackPositionTicks!
        }

        let changedSubs = false
        let changedAudio = false

        episode.MediaStreams?.forEach(stream => {
            if (stream.DisplayTitle === subtitleStream.DisplayTitle && stream.Index === subtitleStream.Index) {
                payload.SubtitleStreamIndex = subtitleStream.Index
                changedSubs = true
            } else if (stream.DisplayTitle === audioStream.DisplayTitle && stream.Index === audioStream.Index) {
                payload.AudioStreamIndex = audioStream.Index
                changedAudio = true
            }
        })

        if (changedSubs || changedAudio) {
            await getPlaystateApi(this.api).reportPlaybackProgress({ playbackProgressInfo: payload })
            await getPlaystateApi(this.api).reportPlaybackStopped({ playbackStopInfo: payload })
        }

        return [changedSubs, changedAudio]
    }
}
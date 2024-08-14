<script lang="ts">
	import { getServer, type Authenticatable, JellyfinClient } from '$lib/Jellyfin'
	import type { BaseItemDto, SearchHint } from '@jellyfin/sdk/lib/generated-client/models'
	import { ProgressRadial, ProgressBar } from '@skeletonlabs/skeleton'

	let serverURL: string
	let server: Authenticatable
	let client: JellyfinClient

	let initError: Error | null
	let testingConnection = false

	const initConnection = async () => {
		testingConnection = true
		initError = null
		try {
			const s = await getServer(serverURL)
			server = s
		} catch (error: any) {
			initError = error
			console.error(error)
		} finally {
			testingConnection = false
		}
		console.log('got connection')
	}

	let username: string
	let password: string
	let authError: Error | null
	let testingAuth = false

	const authenticate = async () => {
		authError = null
		try {
			const loggedIn = await server!.authenticate(username, password)
			client = loggedIn
		} catch (error: any) {
			authError = error
			console.error(error)
		}
		console.log('authenticated')
	}

	let menuIndex = 0

	let timeout: NodeJS.Timeout
	let searchTerm: string
	let searchResults: SearchHint[] = []

	const search = async () => {
		if (menuIndex !== 0) {
			menuIndex = 0
		}
		clearTimeout(timeout)
		timeout = setTimeout(async () => {
			if (!searchTerm) {
				searchResults = []
				return
			}
			const res = await client.getShows(searchTerm)

			if (!res) {
				throw new Error('No show found?')
			}

			searchResults = res
		}, 300)
	}

	let selectedShow: SearchHint
	let seasons: BaseItemDto[]

	const getSeasons = async () => {
		const ss = await client.getSeasons(selectedShow.Id!)

		if (!ss) {
			throw new Error('No seasons found')
		}

		seasons = ss
		menuIndex++
	}

	let selectedSeason: BaseItemDto
	let episodes: BaseItemDto[]

	const getEpisodes = async () => {
		const eps = await client.getEpisodes(selectedShow.Id!, selectedSeason.Id!)

		if (!eps) {
			throw new Error('Season contains no episodes')
		}

		episodes = eps
		menuIndex++
	}

	let selectedEpisode: BaseItemDto
	let episodeInfo: BaseItemDto
	let selectedSubtitleStreamIndex: number
	let selectedAudioStreamIndex: number

	const getEpisode = async () => {
		const ep = await client.getEpisode(selectedEpisode.Id!)

		if (!ep) {
			throw new Error('Season contains no episodes')
		}

		selectedSubtitleStreamIndex = ep.MediaSources![0].DefaultSubtitleStreamIndex!
		selectedAudioStreamIndex = ep.MediaSources![0].DefaultAudioStreamIndex!
		episodeInfo = ep
		menuIndex++
	}

	let errors: string[] = []

	$: {
		if (menuIndex === 0) {
			errors = []
		}
	}

	const setEpisodeDefaults = async () => {
		errors = []
		const subStream = episodeInfo.MediaStreams!.find((e) => e.Index === selectedSubtitleStreamIndex)
		const audioStream = episodeInfo.MediaStreams!.find((e) => e.Index === selectedAudioStreamIndex)

		if (!subStream || !audioStream) {
			throw new Error('unable to find subtitle or audio stream')
		}

		const [changedSubs, changedAudio] = await client.setEpisodeDefaults(
			selectedEpisode.Id!,
			subStream,
			audioStream,
		)

		if (changedAudio && !changedSubs) {
			errors = [
				...errors,
				`Unable to find a matching subtitle track for S${selectedEpisode.ParentIndexNumber}E${selectedEpisode.IndexNumber} ${selectedEpisode.Name}`,
			]
		} else if (!changedAudio && changedSubs) {
			errors = [
				...errors,
				`Unable to find a matching audio track for S${selectedEpisode.ParentIndexNumber}E${selectedEpisode.IndexNumber} ${selectedEpisode.Name}`,
			]
		} else if (!changedAudio && !changedSubs) {
			errors = [
				...errors,
				`Unable find a matching subtitle or audio track for S${selectedEpisode.ParentIndexNumber}E${selectedEpisode.IndexNumber} ${selectedEpisode.Name}`,
			]
		}
	}

	let currentProgress: number | undefined
	let maxProgress: number

	const setSeasonDefaults = async () => {
		errors = []
		const subStream = episodeInfo.MediaStreams!.find((e) => e.Index === selectedSubtitleStreamIndex)
		const audioStream = episodeInfo.MediaStreams!.find((e) => e.Index === selectedAudioStreamIndex)

		if (!subStream || !audioStream) {
			throw new Error('unable to find subtitle or audio stream')
		}

		const mapped = episodes.map((ep) => async () => {
			const [changedSubs, changedAudio] = await client.setEpisodeDefaults(
				ep.Id!,
				subStream,
				audioStream,
			)

			if (changedAudio && !changedSubs) {
				errors = [
					...errors,
					`Unable to find a matching subtitle track for S${ep.ParentIndexNumber}E${ep.IndexNumber} ${ep.Name}`,
				]
			} else if (!changedAudio && changedSubs) {
				errors = [
					...errors,
					`Unable to find a matching audio track for S${ep.ParentIndexNumber}E${ep.IndexNumber} ${ep.Name}`,
				]
			} else if (!changedAudio && !changedSubs) {
				errors = [
					...errors,
					`Unable find a matching subtitle or audio track for S${ep.ParentIndexNumber}E${ep.IndexNumber} ${ep.Name}`,
				]
			}
		})

		currentProgress = 0
		maxProgress = mapped.length

		for await (const job of mapped) {
			await job()
			currentProgress++
		}

		currentProgress = undefined
	}

	const setShowDefaults = async () => {
		errors = []
		const subStream = episodeInfo.MediaStreams!.find((e) => e.Index === selectedSubtitleStreamIndex)
		const audioStream = episodeInfo.MediaStreams!.find((e) => e.Index === selectedAudioStreamIndex)

		if (!subStream || !audioStream) {
			throw new Error('unable to find subtitle or audio stream')
		}

		const mapped = await Promise.all([
			...seasons.map(async (season) => {
				const eps = await client.getEpisodes(selectedShow.Id!, season.Id!)

				if (!eps) {
					console.error('error getting episodes for season ' + season.Name)
					return
				}

				return eps.map((ep) => async () => {
					const [changedSubs, changedAudio] = await client.setEpisodeDefaults(
						ep.Id!,
						subStream,
						audioStream,
					)

					if (changedAudio && !changedSubs) {
						errors = [
							...errors,
							`Unable to find a matching subtitle track for S${ep.ParentIndexNumber}E${ep.IndexNumber} ${ep.Name}`,
						]
					} else if (!changedAudio && changedSubs) {
						errors = [
							...errors,
							`Unable to find a matching audio track for S${ep.ParentIndexNumber}E${ep.IndexNumber} ${ep.Name}`,
						]
					} else if (!changedAudio && !changedSubs) {
						errors = [
							...errors,
							`Unable find a matching subtitle or audio track for S${ep.ParentIndexNumber}E${ep.IndexNumber} ${ep.Name}`,
						]
					}
				})
			}),
		])

		const jobs = mapped.flat().filter((job) => job !== undefined)

		currentProgress = 0
		maxProgress = jobs.length

		for await (const job of jobs) {
			await job()
			currentProgress++
		}

		currentProgress = undefined
	}
</script>

<div class="py-4 h-dvh">
	<div
		class="container h-full mx-auto flex flex-col gap-5 items-center variant-filled-surface px-8 py-6 rounded-container-token"
	>
		<form on:submit={initConnection} class="">
			<div>
				<label for="server-url" class="text-sm block mb-2 font-bold">Server URL</label>
				<div class="flex flex-row gap-1">
					<input
						type="text"
						class="input"
						bind:value={serverURL}
						id="server-url"
						placeholder="Server URL"
						required
					/>
					<button class="btn variant-filled" type="submit">
						{#if initError}
							<i class="fa-solid fa-circle-exclamation"></i>
						{:else if testingConnection}
							<ProgressRadial width="w-4" />
						{:else if server}
							<i class="fa-solid fa-check"></i>
						{:else}
							<i class="fa-solid fa-vials"></i>
						{/if}
						<span>Test</span>
					</button>
				</div>
			</div>
		</form>

		{#if server}
			<form on:submit={authenticate}>
				<div class="flex flex-col gap-1">
					<div class="flex flex-row gap-1">
						<div>
							<label for="username" class="text-sm block mb-2 font-bold">Username</label>
							<input
								type="text"
								class="input"
								bind:value={username}
								id="username"
								placeholder="Username"
								required
							/>
						</div>
						<div>
							<label for="password" class="text-sm block mb-2 font-bold">Password</label>
							<div class="flex flex-row gap-1">
								<input
									type="password"
									class="input"
									bind:value={password}
									id="password"
									placeholder="Password"
									required
								/>
							</div>
						</div>
					</div>
					<button class="btn variant-filled" type="submit">
						{#if authError}
							<i class="fa-solid fa-circle-exclamation"></i>
						{:else if testingAuth}
							<ProgressRadial width="w-4" />
						{:else if client}
							<i class="fa-solid fa-check"></i>
						{:else}
							<i class="fa-solid fa-vials"></i>
						{/if}
						<span>Test</span>
					</button>
				</div>
				<p class="text-xs text-warning-300">
					Your credentials are only used to locally connect with the remote Jellyfin instance.
				</p>
			</form>
		{/if}

		{#if client}
			<div class="w-96">
				<label for="input" class="text-sm block mb-2 font-bold">Search Shows</label>
				<input
					type="text"
					id="search"
					class="input"
					placeholder="Search"
					on:input={search}
					bind:value={searchTerm}
				/>
			</div>
			{#if errors.length > 0}
				<div class="variant-filled-error card w-96 p-4 max-h-64 overflow-y-scroll">
					<h3 class="h3 text-black">Errors</h3>
					{#each errors as error}
						<p class="text-black font-bold text-xs">{error}</p>
					{/each}
				</div>
			{/if}
			<div class="h-4/6 overflow-y-scroll">
				{#if menuIndex === 3 && episodeInfo.MediaStreams}
					<div class="flex flex-col md:flex-row gap-5">
						<div>
							<table class="table table-hover w-80">
								<thead>
									<tr>
										<th
											><button
												class="fa-solid fa-arrow-left cursor-pointer"
												on:click={() => menuIndex--}
											/> Subtitle Tracks</th
										>
									</tr>
								</thead>
								<tbody>
									{#each episodeInfo.MediaStreams.filter((e) => e.Type === 'Subtitle') as mediastream}
										<tr>
											<td
												class="hover:cursor-pointer"
												class:table-row-checked={selectedSubtitleStreamIndex === mediastream.Index}
												on:click={() => {
													if (mediastream.Index === undefined) return
													selectedSubtitleStreamIndex = mediastream.Index
												}}
											>
												{mediastream.DisplayTitle}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<div>
							<table class="table table-hover w-80">
								<thead>
									<tr>
										<th>Audio Tracks</th>
									</tr>
								</thead>
								<tbody>
									{#each episodeInfo.MediaStreams.filter((e) => e.Type === 'Audio') as mediastream}
										<tr>
											<td
												class="hover:cursor-pointer"
												class:table-row-checked={selectedAudioStreamIndex === mediastream.Index}
												on:click={() => {
													if (mediastream.Index === undefined) return
													selectedAudioStreamIndex = mediastream.Index
												}}
											>
												{mediastream.DisplayTitle}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
					<div class="flex flex-col md:flex-row md:justify-between mt-5 gap-3">
						{#if currentProgress !== undefined}
							<div class="w-full variant-filled-primary rounded-token">
								<ProgressBar
									bind:value={currentProgress}
									bind:max={maxProgress}
									meter="variant-filled-tertiary"
								/>
							</div>
						{:else}
							<button class="btn btn-md variant-filled w-full md:w-48" on:click={setEpisodeDefaults}
								>Apply to single episode</button
							>
							<button class="btn btn-md variant-filled w-full md:w-48" on:click={setSeasonDefaults}>
								Apply to whole season
							</button>
							<button class="btn btn-md variant-filled w-full md:w-48" on:click={setShowDefaults}>
								Apply to whole show
							</button>
						{/if}
					</div>
				{:else if menuIndex === 2}
					<table class="table table-hover w-96">
						<thead>
							<tr>
								<th
									><button
										class="fa-solid fa-arrow-left cursor-pointer"
										on:click={() => menuIndex--}
									/> Episodes</th
								>
							</tr>
						</thead>
						<tbody>
							{#each episodes as episode}
								<tr>
									<td
										class="hover:cursor-pointer"
										on:click={() => {
											selectedEpisode = episode
											getEpisode()
										}}
									>
										S{episode.ParentIndexNumber}E{episode.IndexNumber} - {episode.Name}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else if menuIndex === 1}
					<table class="table table-hover w-96">
						<thead>
							<tr>
								<th
									><button
										class="fa-solid fa-arrow-left cursor-pointer"
										on:click={() => menuIndex--}
									/> Seasons</th
								>
							</tr>
						</thead>
						<tbody>
							{#each seasons as season}
								<tr>
									<td
										class="hover:cursor-pointer"
										on:click={() => {
											selectedSeason = season
											getEpisodes()
										}}
									>
										{season.Name}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<table class="table table-hover w-96">
						<thead>
							<tr>
								<th>Title</th>
							</tr>
						</thead>
						<tbody>
							{#each searchResults as item}
								<tr>
									<td
										class="hover:cursor-pointer"
										on:click={() => {
											selectedShow = item
											getSeasons()
										}}
									>
										{item.Name} ({item.ProductionYear})
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		{/if}
	</div>
</div>

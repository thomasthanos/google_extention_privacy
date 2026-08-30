// ==UserScript==
// @name         Nexus Download Wabbajack Modlist
// @namespace    NDWM
// @version      0.5
// @description  Download all mods from NexusMods for a Wabbajack Modlist with a single click
// @author       Drigtime
// @match        https://www.nexusmods.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nexusmods.com
// @compatible   chrome
// @compatible   edge
// @compatible   firefox
// @compatible   safari
// @compatible   brave
// @grant        GM_addStyle
// @connect      nexusmods.com
// @require      https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.57/dist/zip.min.js
// ==/UserScript==
(function() {
// MDI : https://pictogrammers.com/library/mdi/
// MDI : https://github.com/MathewSachin/Captura/blob/master/src/Captura.Core/MaterialDesignIcons.cs
 
/**
 * @typedef {{
 *  $type: string,
 *  Author?: string,
 *  Description?: string,
 *  FileID: number,
 *  GameName: string,
 *  ImageURL?: string,
 *  IsNSFW?: boolean,
 *  ModID: number,
 *  Name?: string,
 *  Version?: string
 * }} NexusModState
 *
 * @typedef {{
 *  Hash: string,
 *  Meta: string,
 *  Name: string,
 *  Size: number,
 *  State: NexusModState
 * }} NexusModArchive
 *
 * @typedef {{
 *  Archives: NexusModArchive[]
 * }} WabbajackModlist
 */
 
// @ts-ignore
GM_addStyle(`
	:root {
		--ndc-primary-color: rgb(217 143 64);
		--ndc-primary-color-subdued: rgb(200 123 40);
		--ndc-text-white: #fff;
	}
 
	.ndc\\:block { display: block; }
	.ndc\\:hidden { display: none; }
	.ndc\\:flex-1 { flex: 1; }
 
	.ndc\\:bg-primary-subdued { background-color: var(--ndc-primary-color-subdued); }
 
	.ndc\\:text-white { color: var(--ndc-text-white); }
	.ndc\\:text-primary { color: var(--ndc-primary-color); }
 
	.spinner-border {
		display: inline-block;
		width: 1.5rem;
		height: 1.5rem;
		vertical-align: text-bottom;
		border: 0.25em solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spinner-border 0.75s linear infinite;
	}
 
	@keyframes spinner-border {
		to { transform: rotate(360deg); }
	}
 
	.ndc\\:badge-primary {
		padding: 0.25rem 0.5rem;
		border-radius: 1rem;
		font-size: 0.75rem;
		color: var(--ndc-text-white);
		background-color: var(--ndc-primary-color);
		white-space: nowrap;
	}
 
	.ndc\\:btn-outline-secondary {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 36px;
		min-height: 36px;
		padding: 4px 8px;
		border: 1px solid rgb(212 212 216);
		border-radius: 0.25rem;
		background-color: rgb(41 41 46);
		color: rgb(212 212 216);
		font: 600 14px/14px "Montserrat", ui-sans-serif, system-ui, sans-serif;
		text-transform: uppercase;
		text-align: center;
		cursor: pointer;
		transition: color 0.15s, background-color 0.15s, border-color 0.15s;
		box-sizing: border-box;
		appearance: button;
	}
 
	.ndc\\:btn-outline-secondary:hover {
		background-color: rgb(51 51 56);
	}
 
	.ndc\\:btn-outline-secondary:disabled {
		background-color: rgba(51 51 56 / 0.5);
		cursor: not-allowed;
	}
 
	.ndc\\:btn-primary {
		min-height: 2.25rem;
		padding: 0.25rem;
		border-radius: 5px;
		background-color: var(--ndc-primary-color);
		color: var(--ndc-text-white);
		font: 600 0.875rem/1 "Montserrat", sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
		transition: background-color 0.3s;
		border: none;
		outline: none;
	}
 
	.ndc\\:btn-primary:disabled {
		background-color: rgba(217 143 64 / 0.5);
		color: rgba(255 255 255 / 0.5);
		cursor: not-allowed;
	}
 
	.ndc-import-btn { border-radius: 0.25rem 0 0 0.25rem; }
	.ndc-import-btn-info { border-radius: 0 0.25rem 0.25rem 0; }
	.ndc-download-btn-all {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		border-radius: 0.25rem 0 0 0.25rem;
	}
	.ndc-download-btn-menu { border-radius: 0 0.25rem 0.25rem 0; }
	.ndc-pause-btn { border-radius: 0; }
	.ndc-stop-btn { border-radius: 0 0.25rem 0.25rem 0; }
 
	.ndc-dropdown {
		position: absolute;
		right: 0;
		top: 0;
		transform: translate3d(0, 38px, 0);
		min-width: 12rem;
		padding: 0.25rem 0;
		border: 1px solid rgba(255 255 255 / 0.2);
		border-radius: 6px;
		background-color: rgb(29 29 33);
		color: rgb(244 244 245);
		font: 400 16px/24px "Montserrat", ui-sans-serif, system-ui, sans-serif;
		box-shadow: 0 9px 12px 1px rgba(0 0 0 / 0.14),
					0 3px 16px 2px rgba(0 0 0 / 0.12),
					0 5px 6px 0 rgba(0 0 0 / 0.2);
		z-index: 10;
		display: none;
	}
 
	.ndc-dropdown-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 44px;
		padding: 8px;
		background-color: transparent;
		color: rgb(244 244 245);
		font: 600 14px/14px "Montserrat", ui-sans-serif, system-ui, sans-serif;
		text-transform: uppercase;
		white-space: nowrap;
		border: 0;
		cursor: pointer;
		width: 100%;
		text-align: left;
	}
 
	.ndc-dropdown-item:hover {
		background-color: var(--ndc-primary-color);
	}
 
	.ndc-progress-bar {
		display: block;
		flex: 1;
		height: 36px;
		min-height: 36px;
		border-radius: 0.25rem;
		background-color: rgb(41 41 46);
		color: rgb(244 244 245);
		font: 400 14px/24px "Montserrat", ui-sans-serif, system-ui, sans-serif;
		overflow: hidden;
		position: relative;
		width: 100%;
	}
 
	.ndc-progress-bar-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 36px;
		width: 0;
		background-color: var(--ndc-primary-color);
		color: rgb(244 244 245);
		font: 400 14px/24px "Montserrat", ui-sans-serif, system-ui, sans-serif;
		transition: width 0.3s ease;
	}
 
	.ndc-progress-bar-text-container {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		align-items: center;
		position: absolute;
		top: 0;
		left: 0;
		height: 36px;
		width: 100%;
		color: var(--ndc-text-white);
		font: 600 14px/14px "Montserrat", ui-sans-serif, system-ui, sans-serif;
		text-transform: uppercase;
		cursor: pointer;
	}
 
	.ndc-progress-bar-text-base {
		height: 14px;
		color: var(--ndc-text-white);
		font: 600 14px/14px "Montserrat", ui-sans-serif, system-ui, sans-serif;
		text-transform: uppercase;
	}
 
	.ndc-progress-bar-text-progress { margin-left: 8px; }
	.ndc-progress-bar-text-center { text-align: center; }
	.ndc-progress-bar-text-right { margin-right: 8px; text-align: right; }
 
	.ndc-modal-backdrop {
		position: fixed;
		inset: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		background-color: rgba(0 0 0 / 0.25);
		backdrop-filter: brightness(50%);
		z-index: 9999;
	}
 
	.ndc-modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 850px;
		height: calc(100vh - 3.5rem);
		padding: 1rem;
		border-radius: 0.5rem;
		background-color: rgb(29 29 33);
	}
 
	.ndc-modal-header,
	.ndc-modal-filter {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
		gap: 0.5rem;
	}
 
	.ndc-modal-header-title {
		font: 600 1.125rem "Montserrat", sans-serif;
		text-transform: uppercase;
	}
 
	.ndc-modal-header-dropdown-btn {
		padding: 0.25rem;
		border-radius: 0.25rem;
	}
 
	.ndc-modal-filter input,
	.ndc-modal-filter select {
		padding: 0.25rem;
		border: 1px solid rgb(212 212 216);
		border-radius: 0.25rem;
		flex: 0 1 auto;
		color: #000;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
	}
 
	.ndc-modal-mods-list {
		display: block;
		height: 100%;
		margin-bottom: 0.5rem;
		overflow-y: auto;
	}
 
	.ndc-modal-mods-list-header {
		display: none;
		gap: 0.5rem;
		border: 1px solid hsla(0 0% 100% / 0.2);
		padding: 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		user-select: none;
	}
 
	.ndc-modal-mods-list-header span {
		font: 600 0.875rem "Montserrat", sans-serif;
		text-transform: uppercase;
		color: rgb(161 161 170);
	}
 
	.ndc-modal-mods-list-body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
 
	.ndc-modal-mods-list-body-row {
		border: 1px solid hsla(0 0% 100% / 0.2);
		padding: 0.5rem;
		cursor: pointer;
		user-select: none;
	}
 
	.ndc-modal-mods-list-body-row:last-child {
		border-radius: 0 0 0.25rem 0.25rem;
	}
 
	.ndc-modal-actions {
		display: flex;
		justify-content: end;
		gap: 0.5rem;
	}
 
	@media (min-width: 640px) {
		.ndc-modal-filter input,
		.ndc-modal-filter select { width: auto; }
		.ndc-modal-mods-list-header { display: flex; border-radius: 0; }
		.ndc-modal-mods-list-body { gap: 0; }
		.ndc\\:sm\\:block { display: block; }
		.ndc\\:sm\\:hidden { display: none; }
		.ndc\\:sm\\:flex { display: flex; }
		.ndc\\:sm\\:flex-none { flex: none; }
		.ndc\\:sm\\:gap-0\\.5 { gap: 0.5rem; }
	}
`);
 
// https://github.com/wabbajack-tools/wabbajack/blob/main/Wabbajack.DTOs/Game/GameRegistry.cs
const wabbajackGames = {
	"Morrowind": {
		"NexusName": "morrowind",
		"NexusGameId": 100
	},
	"Oblivion": {
		"NexusName": "oblivion",
		"NexusGameId": 101
	},
	"Fallout3": {
		"NexusName": "fallout3",
		"NexusGameId": 120
	},
	"FalloutNewVegas": {
		"NexusName": "newvegas",
		"NexusGameId": 130
	},
	"Skyrim": {
		"NexusName": "skyrim",
		"NexusGameId": 110
	},
	"SkyrimSpecialEdition": {
		"NexusName": "skyrimspecialedition",
		"NexusGameId": 1704
	},
	"Fallout4": {
		"NexusName": "fallout4",
		"NexusGameId": 1151
	},
	"SkyrimVR": {
		"NexusName": "skyrimspecialedition",
		"NexusGameId": 1704
	},
	"Enderal": {
		"NexusName": "enderal",
		"NexusGameId": 2736
	},
	"EnderalSpecialEdition": {
		"NexusName": "enderalspecialedition",
		"NexusGameId": 3685
	},
	"Fallout4VR": {
		"NexusName": "fallout4",
		"NexusGameId": 1151
	},
	"DarkestDungeon": {
		"NexusName": "darkestdungeon",
		"NexusGameId": 804
	},
	"Dishonored": {
		"NexusName": "dishonored",
		"NexusGameId": 802
	},
	"Witcher": {
		"NexusName": "witcher",
		"NexusGameId": 150
	},
	"Witcher3": {
		"NexusName": "witcher3",
		"NexusGameId": 952
	},
	"StardewValley": {
		"NexusName": "stardewvalley",
		"NexusGameId": 1303
	},
	"KingdomComeDeliverance": {
		"NexusName": "kingdomcomedeliverance",
		"NexusGameId": 2298
	},
	"MechWarrior5Mercenaries": {
		"NexusName": "mechwarrior5mercenaries",
		"NexusGameId": 3099
	},
	"NoMansSky": {
		"NexusName": "nomanssky",
		"NexusGameId": 1634
	},
	"DragonAgeOrigins": {
		"NexusName": "dragonage",
		"NexusGameId": 140
	},
	"DragonAge2": {
		"NexusName": "dragonage2",
		"NexusGameId": 141
	},
	"DragonAgeInquisition": {
		"NexusName": "dragonageinquisition",
		"NexusGameId": 728
	},
	"KerbalSpaceProgram": {
		"NexusName": "kerbalspaceprogram",
		"NexusGameId": 272
	},
	"Terraria": {
		"NexusName": null,
		"NexusGameId": null
	},
	"Cyberpunk2077": {
		"NexusName": "cyberpunk2077",
		"NexusGameId": 3333
	},
	"Sims4": {
		"NexusName": "thesims4",
		"NexusGameId": 641
	},
	"DragonsDogma": {
		"NexusName": "dragonsdogma",
		"NexusGameId": 1249
	},
	"KarrynsPrison": {
		"NexusName": null,
		"NexusGameId": null
	},
	"Valheim": {
		"NexusName": "valheim",
		"NexusGameId": 3667
	},
	"MountAndBlade2Bannerlord": {
		"NexusName": "mountandblade2bannerlord",
		"NexusGameId": 3174
	},
	"FinalFantasy7Remake": {
		"NexusName": "finalfantasy7remake",
		"NexusGameId": 4202
	},
	"BaldursGate3": {
		"NexusName": "baldursgate3",
		"NexusGameId": 3474
	},
	"Starfield": {
		"NexusName": "starfield",
		"NexusGameId": 4187
	},
	"SevenDaysToDie": {
		"NexusName": "7daystodie",
		"NexusGameId": 1059
	},
	"ModdingTools": {
		"NexusName": "site",
		"NexusGameId": 2295
	}
}
 
const convertSize = (/** @type {number} */ sizeInByte) => {
	// 3769655540 => 3.51 GB
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	let size = sizeInByte;
	while (size >= 1024) {
		size /= 1024;
		i++;
	}
	return `${size.toFixed(2)} ${units[i]}`;
};
 
// Custom error classes
class NDCDownloadError extends Error {
	/**
	 * @param {string | undefined} message
	 */
	constructor(message) {
		super(message);
		this.name = 'DownloadError';
	}
}
 
class NDCCaptchaError extends NDCDownloadError {
	/**
	 * @param {string} url
	 */
	constructor(url) {
		super(`Captcha required for ${url}`);
		this.name = 'CaptchaError';
		this.url = url;
	}
}
 
class NDCSuspendedError extends NDCDownloadError {
	constructor() {
		super('Account temporarily suspended');
		this.name = 'SuspendedError';
	}
}
 
class NDCRateLimitError extends NDCDownloadError {
	constructor() {
		super('Too many requests');
		this.name = 'RateLimitError';
	}
}
 
class Mod {
	/**
	 * @param {string} modName
	 * @param {string} url
	 * @param {number} size
	 * @param {number} gameId
	 * @param {number} modId
	 * @param {number} fileId
	 * @param {string} fileName
	 */
	constructor(modName, url, size, gameId, modId, fileId, fileName) {
		this.modName = modName;
		this.url = url;
		this.size = size;
		this.gameId = gameId;
		this.modId = modId;
		this.fileId = fileId;
		this.fileName = fileName;
	}
}
 
class NDC {
	/** @type {NDCDownloadButton} */ downloadButton
	/** @type {NDCProgressBar} */ progressBar
	/** @type {NDCLogConsole} */ console
	/** @type {Mod[]} */ mods = []
	/** @type {HTMLDivElement} */ element
 
	constructor() {
		this.element = this.createElement();
		this.initComponents();
	}
 
	/**
	 * Creates a styled <div> element with predefined styles.
	 *
	 * @returns {HTMLDivElement} A <div> element with custom styles applied.
	 */
	createElement() {
		const div = document.createElement("div");
		Object.assign(div.style, {
			borderRadius: "0.5rem",
			border: "2px solid rgb(217 143 64)",
			padding: "1rem",
			marginTop: "1rem",
			backgroundColor: "rgb(17 17 17)",
			backgroundImage: "url(data:image/png;base64,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)",
			backgroundSize: "100%",
			backgroundPosition: "center",
			backgroundRepeat: "no-repeat",
			width: "100%"
		});
		return div;
	}
 
	/**
	 * Initializes the UI components for the application.
	 * Creates instances of NDCDownloadButton, NDCProgressBar, and NDCLogConsole,
	 * and appends their elements to the parent element.
	 */
	initComponents() {
		this.downloadButton = new NDCDownloadButton(this);
		this.progressBar = new NDCProgressBar(this);
		this.console = new NDCLogConsole(this);
 
		this.element.append(
			this.downloadButton.element,
			this.progressBar.element,
			this.console.element
		);
	}
 
	/**
	 * Fetches the download link for a given mod from Nexus Mods.
	 *
	 * @param {Mod} mod - The mod object to fetch the download link for.
	 * @returns {Promise<string>} The download URL of the mod.
	 * @throws {NDCCaptchaError} If a CAPTCHA is encountered during the request.
	 * @throws {NDCSuspendedError} If the account is temporarily suspended.
	 * @throws {NDCRateLimitError} If the request is rate-limited.
	 */
	async fetchDownloadLink(mod) {
		this.bypassNexusAdsCookie();
 
		const downloadResponse = await fetch(
			"https://www.nexusmods.com/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl",
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
				body: `fid=${mod.fileId}&game_id=${mod.gameId}`
			}
		);
 
		if (!downloadResponse.ok && downloadResponse.status === 429) {
			const text = await downloadResponse.text();
			if (text.includes("Just a moment...")) throw new NDCCaptchaError(mod.url);
			if (text.includes("temporarily suspended")) throw new NDCSuspendedError();
			throw new NDCRateLimitError();
		}
 
		const fileLink = await downloadResponse.json();
 
		return fileLink?.url || "";
	}
 
 
	/**
	 * Sets a cookie to bypass Nexus Mods ads by simulating an "ab" cookie with a short expiration time.
	 *
	 * The cookie is set to expire in 5 minutes and is scoped to the "nexusmods.com" domain.
	 */
	bypassNexusAdsCookie() {
		const expiry = new Date(Date.now() + 5 * 60 * 1000).toUTCString();
		document.cookie = `ab=0|${Math.round(Date.now() / 1000) + 300};expires=${expiry};domain=nexusmods.com;path=/`;
	}
 
	/**
	 * Downloads a list of mods while handling various errors and download states.
	 *
	 * @async
	 * @param {Mod[]} mods - The list of mods to download.
	 * @throws {Error} Throws an error if a critical issue occurs during the download process.
	 *
	 * @description
	 * This method manages the download process for a list of mods. It initializes the download,
	 * processes each mod sequentially, and handles errors such as rate limits, captchas, and account suspensions.
	 * The method also supports pausing and resuming downloads and logs failed downloads for further review.
	 *
	 * Error Handling:
	 * - Captcha errors: Pauses the download and waits for the user to solve the captcha.
	 * - Account suspension: Waits for 10 minutes before retrying.
	 * - Rate limiting: Waits for 5 minutes before retrying.
	 * - Other errors: Logs the error and stops the download process.
	 *
	 * Workflow:
	 * 1. Initializes the download process and progress bar.
	 * 2. Iterates through the list of mods, skipping or stopping as necessary.
	 * 3. Fetches the download link for each mod and handles success or failure.
	 * 4. Waits for a delay between downloads if required.
	 * 5. Logs any failed downloads at the end of the process.
	 * 6. Finalizes the download process.
	 */
	async downloadMods(mods) {
		this.initializeDownload(mods.length);
 
		try {
			const downloadState = { count: 0 };
			const failedMods = [];
			let currentIndex = 0;
 
			while (currentIndex < mods.length) {
				const mod = mods[currentIndex];
				if (this.shouldSkipDownload(currentIndex, mods.length)) {
					currentIndex++;
					continue;
				}
				if (this.progressBar.state.status === NDCProgressBar.STATUS.STOPPED) {
					this.console.log("Download stopped.", NDCLogConsole.TYPE.INFO);
					break;
				}
 
				const modNum = `${(currentIndex + 1).toString().padStart(mods.length.toString().length, "0")}/${mods.length}`;
 
				try {
					const downloadUrl = await this.fetchDownloadLink(mod);
 
					if (!downloadUrl) {
						this.handleDownloadError(mod, modNum, false, failedMods);
						currentIndex++;
					} else {
						this.handleDownloadSuccess(mod, modNum, downloadUrl, downloadState);
						currentIndex++;
					}
				} catch (error) {
					if (error instanceof NDCCaptchaError) {
						const url = error.url;
						this.console.logError(
							`You are rate limited by Cloudflare. <a href="${url}" target="_blank" class="ndc:text-primary">Solve captcha</a> then unpause to retry.`
						);
						this.progressBar.setStatus(NDCProgressBar.STATUS.PAUSED);
						await this.waitForUnpause();
					} else if (error instanceof NDCSuspendedError) {
						this.console.logError("Account temporarily suspended. Waiting 10 minutes...");
						await this.waitWithCountdown(10 * 60, "Waiting 10 minutes due to suspension...");
					} else if (error instanceof NDCRateLimitError) {
						this.console.logError("Too many requests. Waiting 5 minutes...");
						await this.waitWithCountdown(5 * 60, "Waiting 5 minutes due to rate limit...");
					} else {
						this.console.logError(error.message);
						this.handleDownloadError(mod, modNum, true, failedMods);
						this.console.logError("Download forced to stop due to an error.");
						break;
					}
				}
 
				if (currentIndex < mods.length) {
					await this.handleDownloadDelay(downloadState);
				}
			}
 
			if (failedMods.length) this.logFailedDownloads(failedMods);
		} catch (error) {
			this.console.logError("An error occurred during the download.");
			console.error(error);
		}
 
		this.finalizeDownload();
	}
 
	/**
	 * Waits for the progress bar to exit the paused state.
	 * This function continuously checks the status of the progress bar
	 * and resolves the promise once the status is no longer "PAUSED".
	 *
	 * @async
	 * @returns {Promise<void>} A promise that resolves when the progress bar is unpaused.
	 */
	async waitForUnpause() {
		return new Promise(resolve => {
			const checkUnpause = setInterval(() => {
				if (this.progressBar.state.status !== NDCProgressBar.STATUS.PAUSED) {
					clearInterval(checkUnpause);
					resolve();
				}
			}, 100);
		});
	}
 
	/**
	 * Determines whether the current download should be skipped based on the progress bar's state.
	 *
	 * @param {number} index - The index of the current download in the list.
	 * @param {number} total - The total number of downloads.
	 * @returns {boolean} - Returns `true` if the download should be skipped, otherwise `false`.
	 */
	shouldSkipDownload(index, total) {
		if (this.progressBar.state.skipTo && this.progressBar.state.skipToIndex - 1 > index) {
			this.console.log(`[${(index + 1).toString().padStart(total.toString().length, "0")}/${total}] Skipping <a href="${this.mods[index].url}" target="_blank" class="ndc:text-primary">${this.mods[index].modName}</a>`);
			this.progressBar.incrementProgress();
			if (this.progressBar.state.skipToIndex - 1 === index + 1) {
				this.progressBar.state.skipTo = false;
			}
			return true;
		}
		this.progressBar.state.skipTo = false;
		return false;
	}
 
	/**
	 * Handles the error that occurs when a download link for a mod cannot be retrieved.
	 *
	 * @param {Mod} mod - The mod object containing details about the mod.
	 * @param {string} modNum - The numerical identifier of the mod.
	 * @param {boolean} critical - Indicates whether the error is critical.
	 * @param {Mod[]} failedMods - An array to store mods that failed to download if the error is not critical.
	 */
	handleDownloadError(mod, modNum, critical, failedMods) {
		const logRow = this.console.logError(
			`[${modNum}] Failed to get download link for <a href="${mod.url}" target="_blank" class="ndc:text-primary">${mod.modName}</a> <button class="ndc:text-primary"><svg style="height: .75rem;" viewBox="0 3 24 17" xmlns="http://www.w3.org/2000/svg"><path style="fill: currentcolor;" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg></button>`,
		);
		logRow.querySelector("button")?.addEventListener("click", () => {
			navigator.clipboard.writeText("Response not available");
			alert("Response copied to clipboard");
		});
		if (!critical) failedMods.push(mod);
	}
 
	/**
	 * Handles the successful download of a mod by logging the download details,
	 * creating a download link, and updating the progress bar and download state.
	 *
	 * @param {Mod} mod - The mod object containing details about the mod.
	 * @param {string} modNum - The index or number of the mod being downloaded.
	 * @param {string} downloadUrl - The URL from which the mod is being downloaded.
	 * @param {{count: number}} downloadState - The download state object containing the download count.
	 */
	handleDownloadSuccess(mod, modNum, downloadUrl, downloadState) {
		this.console.log(
			`[${modNum}] Downloading <a href="${mod.url}" target="_blank" class="ndc:text-primary">${mod.modName}</a><a href="${downloadUrl}"><svg style="height: .75rem;" class="ndc:text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 3 24 17"><path style="fill: currentcolor;" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/></svg></a><span style="font-size: .75rem; color: rgb(161 161 170)">(${convertSize(mod.size)})</span>`
		);
		const link = document.createElement("a");
		link.href = downloadUrl;
		link.download = mod.fileName;
		link.click();
		this.progressBar.incrementProgress();
		downloadState.count++;
	}
 
	/**
	 * @param {{ count: number; }} downloadState
	 */
	async handleDownloadDelay(downloadState) {
		if (downloadState.count >= 200) {
			await this.waitWithCountdown(5 * 60, "Waiting 5 minutes to avoid Nexus ban...");
			downloadState.count = 0;
		}
 
		await this.waitWithCountdown(1, "Waiting before next download...");
	}
 
	/**
	 * Waits for a specified number of seconds while displaying a countdown message.
	 * The countdown can be interrupted by certain states of the progress bar.
	 * @async
	 *
	 * @param {number} seconds - The number of seconds to wait.
	 * @param {string} initialMessage - The initial message to display in the log.
	 * @returns {Promise<void>} A promise that resolves when the countdown completes or is interrupted.
	 */
	async waitWithCountdown(seconds, initialMessage) {
		let remaining = seconds;
		let logRow = this.console.logInfo(initialMessage);
 
		return new Promise(resolve => {
			const interval = setInterval(() => {
				if (this.progressBar.state.skipPause || this.progressBar.state.skipTo ||
					this.progressBar.state.status === NDCProgressBar.STATUS.STOPPED) {
					this.progressBar.state.skipPause = false;
					clearInterval(interval);
					logRow.remove();
					resolve();
					return;
				}
 
				if (this.progressBar.state.status === NDCProgressBar.STATUS.PAUSED) return;
 
				remaining--;
				const mins = Math.floor(remaining / 60);
				const secs = remaining % 60;
				logRow.innerHTML = `Waiting ${mins} minutes and ${secs} seconds...`;
 
				if (remaining <= 0) {
					clearInterval(interval);
					logRow.remove();
					resolve();
				}
			}, 1000);
		});
	}
 
	/**
	 * Logs the list of failed mod downloads to the console.
	 *
	 * @param {Mod[]} failedMods - The list of mods that failed to download.
	 */
	logFailedDownloads(failedMods) {
		this.console.logInfo(`Failed to download ${failedMods.length} mods:`);
		failedMods.forEach(mod =>
			this.console.logInfo(`<a href="${mod.url}" target="_blank" class="ndc:text-primary">${mod.modName}</a>`)
		);
	}
 
	/**
	 * Initializes the download process by setting up the progress bar,
	 * updating its status, and hiding the download button.
	 *
	 * @param {number} modsCount - The total number of mods to be downloaded.
	 */
	initializeDownload(modsCount) {
		this.progressBar.setModsCount(modsCount);
		this.progressBar.setProgress(0);
		this.progressBar.setStatus(NDCProgressBar.STATUS.DOWNLOADING);
		this.downloadButton.element.style.display = "none";
		this.progressBar.element.style.display = "flex";
		this.console.logInfo("Download started.");
	}
 
	/**
	 * Finalizes the download process by updating the progress bar status,
	 * hiding the progress bar, displaying the download button, and logging
	 * a completion message to the console.
	 */
	finalizeDownload() {
		this.progressBar.setStatus(NDCProgressBar.STATUS.FINISHED);
		this.progressBar.element.style.display = "none";
		this.downloadButton.element.style.display = "flex";
		this.console.logInfo("Download finished.");
	}
}
 
class NDCDownloadButton {
	/** @type {HTMLButtonElement | null} */ importBtn
	/** @type {HTMLButtonElement | null} */ infoBtn
	/** @type {HTMLButtonElement | null} */ downloadAllBtn
	/** @type {HTMLButtonElement | null} */ selectBtn
	/** @type {HTMLButtonElement | null} */ menuBtn
	/** @type {HTMLElement | null} */ dropdown
	/** @type {HTMLElement | null} */ modsCount
 
	/** @param {NDC} ndc */
	constructor(ndc) {
		this.ndc = ndc;
		this.element = this.createElement();
		this.setupElements();
		this.attachEventListeners();
		this.render();
	}
 
	createElement() {
		const div = document.createElement("div");
		div.id = "ndc-download-button";
		Object.assign(div.style, {
			display: "flex",
			flexDirection: "column",
			gap: "1rem",
			width: "100%"
		});
 
		div.innerHTML = `
			<div style="display: flex; justify-content: center;">
				<button class="ndc:btn-outline-secondary ndc-import-btn ndc:flex-1 ndc:sm:flex-none">Import Wabbajack modlist</button>
				<button class="ndc:btn-outline-secondary ndc-import-btn-info">
					<svg style="width: 1.5rem; height: 1.5rem; cursor: pointer; fill: currentcolor;"
							xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
						<title>information</title>
						<path d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>
					</svg>
				</button>
			</div>
			<div style="display: flex; width: 100%;">
				<button class="ndc:btn-primary ndc-download-btn-all">
					download all mods
					<span style="padding: 0.5rem; background: rgba(29, 29, 33, 0.8); border-radius: 5px; font-size: 0.75rem;" class="ndc:text-white">
						<span class="mods-number"></span> mods
					</span>
				</button>
				<div style="position: relative;">
					<button class="ndc:btn-primary ndc-download-btn-menu" style="height: 100%">
						<svg style="width: 1.5rem; height: 1.5rem;"
								xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
							<path style="fill: currentcolor;" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
						</svg>
					</button>
					<div class="ndc-dropdown">
						<button class="ndc-dropdown-item">Select mods to download</button>
					</div>
				</div>
			</div>
		`;
		return div;
	}
 
	setupElements() {
		this.importBtn = this.element.querySelector(".ndc-import-btn");
		this.infoBtn = this.element.querySelector(".ndc-import-btn-info");
		this.downloadAllBtn = this.element.querySelector(".ndc-download-btn-all");
		this.modsCount = this.element.querySelector(".mods-number");
		this.menuBtn = this.element.querySelector(".ndc-download-btn-menu");
		this.selectBtn = this.element.querySelector(".ndc-dropdown-item");
		this.dropdown = this.element.querySelector(".ndc-dropdown");
	}
 
	attachEventListeners() {
		this.importBtn?.addEventListener("click", () => this.handleFileImport());
		this.infoBtn?.addEventListener("click", () => this.showImportInfo());
		this.downloadAllBtn?.addEventListener("click", () => this.ndc.downloadMods(this.ndc.mods));
		this.selectBtn?.addEventListener("click", () => this.showSelectModsModal());
		this.menuBtn?.addEventListener("click", () => this.toggleDropdown());
		document.addEventListener("click", (e) => this.closeDropdownOnOutsideClick(e));
	}
 
	/**
	 * Handles the processing of a Wabbajack file, extracting and validating its contents,
	 * and processing Nexus mods information for rendering.
	 *
	 * @async
	 * @param {Blob} file - The Wabbajack file to process.
	 * @returns {Promise<void>} Resolves when the file is successfully processed or logs errors if any issues occur.
	 *
	 * @throws {Error} Logs errors for various failure points, including:
	 * - Missing or invalid file input.
	 * - Issues reading or extracting the zip file.
	 * - Invalid or missing "modlist" entry in the zip file.
	 * - Parsing errors or invalid structure in the "modlist" JSON.
	 * - Errors while processing individual mods.
	 *
	 * @example
	 * const fileInput = document.querySelector('#fileInput');
	 * fileInput.addEventListener('change', async (event) => {
	 *     const file = event.target.files[0];
	 *     await handleWabbajackFile(file);
	 * });
	 */
	async handleWabbajackFile(file) {
		try {
			// Validate input
			if (!file) {
				this.ndc.console.logError("No file provided");
				return;
			}
 
			// Initialize ZipReader with error handling
			let entries;
			try {
				// @ts-ignore
				const zipReader = new zip.ZipReader(new zip.BlobReader(file));
				entries = await zipReader.getEntries({});
			} catch (zipError) {
				this.ndc.console.logError("Failed to read zip file: " + zipError.message);
				return;
			}
 
			// Check if entries exist
			if (!entries || entries.length === 0) {
				this.ndc.console.logError("No entries found in zip file");
				return;
			}
 
			// Find modlist entry
			const modListEntry = entries.find(entry => entry?.filename === "modlist");
			if (!modListEntry) {
				this.ndc.console.logError("modlist file not found");
				return;
			}
 
			// Extract and parse modlist data
			let modList;
			try {
				// @ts-ignore
				modList = await modListEntry.getData(new zip.TextWriter());
			} catch (extractError) {
				this.ndc.console.logError("Failed to extract modlist: " + extractError.message);
				return;
			}
 
			/** @type {WabbajackModlist} */
			let mods;
			try {
				mods = JSON.parse(modList);
				if (!mods?.Archives || !Array.isArray(mods.Archives)) {
					throw new Error("Invalid modlist structure");
				}
			} catch (parseError) {
				this.ndc.console.logError("Invalid modlist format: " + parseError.message);
				return;
			}
 
			/** @type {NexusModArchive[]} */
			const nexusMods = mods.Archives.filter((/** @type {NexusModArchive} */ mod) =>
				mod?.State && mod.State['$type'] === "NexusDownloader, Wabbajack.Lib"
			);
 
			/** @type {Mod[]} */
			const processedMods = [];
 
			for (const mod of nexusMods) {
				try {
					// Validate mod structure
					if (!mod?.State || !mod.State.GameName || !mod.State.ModID || !mod.State.FileID) {
						this.ndc.console.logError(`Skipping invalid mod: ${mod?.Name || 'unknown'}`);
						continue;
					}
 
					const { NexusGameId: gameId, NexusName: gameName } = wabbajackGames[mod.State.GameName] || {};
					if (!gameId || !gameName) {
						this.ndc.console.logError(`Unsupported game: ${mod.State.GameName}`);
						continue;
					}
 
					// Construct mod object with fallback values
					processedMods.push(
						new Mod(
							mod.State.Name || "Unknown Mod",
							`https://www.nexusmods.com/${gameName}/mods/${mod.State.ModID}?tab=files&file_id=${mod.State.FileID}`,
							mod.Size || 0,
							gameId,
							mod.State.ModID,
							mod.State.FileID,
							mod.Name || "Unknown File"
						)
					);
				} catch (modError) {
					this.ndc.console.logError(`Error processing mod ${mod?.Name || 'unknown'}: ${modError.message}`);
					continue;
				}
			}
 
			// Update mods array and render
			this.ndc.mods = processedMods;
 
			this.render();
 
			this.ndc.console.logInfo(`Wabbajack Modlist loaded successfully. Processed ${processedMods.length} mods.`);
		} catch (error) {
			this.ndc.console.logError("Unexpected error in handleWabbajackFile: " + error.message);
		}
	}
 
	async handleFileImport() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".wabbajack";
 
		input.addEventListener("change", async () => {
			if (this.importBtn) {
				this.importBtn.disabled = true;
				this.importBtn.innerHTML = `
				<div class="spinner-border" style="margin-right: 0.25rem;"></div>
				Importing...
				`;
			}
			if (input.files && input.files[0]) {
				await this.handleWabbajackFile(input.files[0]);
			} else {
				this.ndc.console.logError("No file selected.");
			}
			if (this.importBtn) {
				this.importBtn.disabled = false;
				this.importBtn.innerHTML = "Import Wabbajack modlist";
			}
			input.remove();
		});
 
		input.click();
	}
 
	showImportInfo() {
		alert(
			"How to import a Wabbajack modlist?\n\n" +
			"1. Download the modlist from Wabbajack.\n" +
			"2. Click on 'Import Wabbajack modlist'.\n" +
			"3. Select the downloaded modlist file (.wabbajack).\n" +
			"This file should be in your Wabbajack installation folder.\n" +
			"(ex: C:\\Wabbajack\\3.7.5.3\\downloaded_mod_lists\\*.wabbajack)\n\n" +
			"The modlist will be loaded and you can download the mods."
		);
	}
 
	toggleDropdown() {
		if (this.dropdown) {
			this.dropdown.style.display = this.dropdown.style.display === "block" ? "none" : "block";
		}
	}
 
	/**
	 * Handles the closing of a dropdown menu when a click occurs outside of the menu button.
	 *
	 * @param {MouseEvent} event - The mouse event triggered by the user's click.
	 */
	closeDropdownOnOutsideClick(event) {
		if (this.menuBtn && event.target instanceof Node && !this.menuBtn.contains(event.target) && this.dropdown) {
			this.dropdown.style.display = "none";
		}
	}
 
	showSelectModsModal() {
		const modal = new NDCSelectModsModal(this.ndc);
		document.body.appendChild(modal.element);
		modal.render();
	}
 
	updateModsCount() {
		const count = this.ndc.mods.length;
		if (this.modsCount) {
			this.modsCount.textContent = count.toString();
		}
		if (this.downloadAllBtn) {
			this.downloadAllBtn.disabled = count === 0;
		}
		if (this.menuBtn) {
			this.menuBtn.disabled = count === 0;
		}
	}
 
	render() {
		this.updateModsCount();
	}
}
 
/**
 * Represents a progress bar component for tracking the progress of mod downloads.
 * This class manages the visual representation of progress, including percentage completion,
 * status updates (e.g., downloading, paused, finished, stopped), and user interactions
 * such as pausing, stopping, or skipping downloads.
 */
class NDCProgressBar {
	/**
	 * Enum representing the various statuses of a process.
	 * @enum {number}
	 * @property {number} DOWNLOADING - Indicates the process is currently downloading.
	 * @property {number} PAUSED - Indicates the process is paused.
	 * @property {number} FINISHED - Indicates the process has finished.
	 * @property {number} STOPPED - Indicates the process has been stopped.
	 */
	static STATUS = {
		DOWNLOADING: 0,
		PAUSED: 1,
		FINISHED: 2,
		STOPPED: 3
	};
 
	/**
	 * A mapping of progress bar statuses to their corresponding display text.
	 *
	 * @constant {Object} STATUS_LABEL
	 * @property {string} [NDCProgressBar.STATUS.DOWNLOADING] - Text displayed when the status is "Downloading...".
	 * @property {string} [NDCProgressBar.STATUS.PAUSED] - Text displayed when the status is "Paused".
	 * @property {string} [NDCProgressBar.STATUS.FINISHED] - Text displayed when the status is "Finished".
	 * @property {string} [NDCProgressBar.STATUS.STOPPED] - Text displayed when the status is "Stopped".
	 */
	static STATUS_LABEL = {
		[NDCProgressBar.STATUS.DOWNLOADING]: "Downloading...",
		[NDCProgressBar.STATUS.PAUSED]: "Paused",
		[NDCProgressBar.STATUS.FINISHED]: "Finished",
		[NDCProgressBar.STATUS.STOPPED]: "Stopped"
	};
 
	/** @type {HTMLElement | null} */ statusText
	/** @type {HTMLButtonElement | null} */ pauseBtn
	/** @type {HTMLButtonElement | null} */ stopBtn
	/** @type {HTMLButtonElement | null} */ skipPauseBtn
	/** @type {HTMLButtonElement | null} */ skipToBtn
	/** @type {HTMLInputElement | null} */ skipInput
	/** @type {HTMLElement | null} */ progressFill
	/** @type {HTMLElement | null} */ progressText
	/** @type {HTMLElement | null} */ countText
 
	/** @param {NDC} ndc */
	constructor(ndc) {
		this.ndc = ndc;
		this.state = {
			modsCount: 0,
			progress: 0,
			status: NDCProgressBar.STATUS.DOWNLOADING,
			skipPause: false,
			skipTo: false,
			skipToIndex: 0
		};
 
		this.element = this.createElement();
		this.setupElements();
		this.attachEventListeners();
	}
 
	createElement() {
		const div = document.createElement("div");
		Object.assign(div.style, {
			display: "none",
			flexWrap: "wrap",
			width: "100%"
		});
 
		div.innerHTML = `
			<div class="ndc-progress-bar">
				<div class="ndc-progress-bar-fill"></div>
				<div class="ndc-progress-bar-text-container">
					<div class="ndc-progress-bar-text-base ndc-progress-bar-text-progress">0%</div>
					<div class="ndc-progress-bar-text-base ndc-progress-bar-text-center">Downloading...</div>
					<div class="ndc-progress-bar-text-base ndc-progress-bar-text-right">0/0</div>
				</div>
			</div>
			<div style="display: flex;">
				<button class="ndc:btn-primary ndc-pause-btn">
					<svg style="width: 1.5rem; height: 1.5rem; fill: currentcolor;"
							viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
						<path d="M14,19H18V5H14M6,19H10V5H6V19Z"/>
					</svg>
				</button>
				<button class="ndc:btn-primary ndc-stop-btn">
					<svg style="width: 1.5rem; height: 1.5rem; fill: currentcolor;"
							viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
						<path d="M18,18H6V6H18V18Z"/>
					</svg>
				</button>
			</div>
			<div style="display: flex; margin: 0.5rem 0; justify-content: flex-end; flex-basis: 100%;">
				<div style="display: flex; gap: 0.5rem; align-items: center;">
					<button class="ndc:btn-primary ndc-skip-pause-btn">Skip pause</button>
					<button class="ndc:btn-primary ndc-skip-to-index-btn">Skip to index</button>
					<input class="ndc-skip-to-index-input"
							style="background: rgb(41, 41, 46); border: 1px solid rgb(161, 161, 170);
							border-radius: 4px; color: rgb(161, 161, 170); font: 400 16px/24px 'Montserrat', sans-serif;
							height: 36px; padding: 0.5rem; width: 80px;"
							type="number" min="0" placeholder="Index">
				</div>
			</div>
		`;
		return div;
	}
 
	setupElements() {
		this.progressFill = this.element.querySelector(".ndc-progress-bar-fill");
		this.progressText = this.element.querySelector(".ndc-progress-bar-text-progress");
		this.statusText = this.element.querySelector(".ndc-progress-bar-text-center");
		this.countText = this.element.querySelector(".ndc-progress-bar-text-right");
		this.pauseBtn = this.element.querySelector(".ndc-pause-btn");
		this.stopBtn = this.element.querySelector(".ndc-stop-btn");
		this.skipPauseBtn = this.element.querySelector(".ndc-skip-pause-btn");
		this.skipToBtn = this.element.querySelector(".ndc-skip-to-index-btn");
		this.skipInput = this.element.querySelector(".ndc-skip-to-index-input");
	}
 
	attachEventListeners() {
		this.pauseBtn?.addEventListener("click", () => this.togglePause());
		this.stopBtn?.addEventListener("click", () => this.setStatus(NDCProgressBar.STATUS.STOPPED));
		this.skipPauseBtn?.addEventListener("click", () => this.skipPauseDownload());
		this.skipToBtn?.addEventListener("click", () => this.skipToIndex());
	}
 
	togglePause() {
		const newStatus = this.state.status === NDCProgressBar.STATUS.DOWNLOADING
			? NDCProgressBar.STATUS.PAUSED
			: NDCProgressBar.STATUS.DOWNLOADING;
		this.setStatus(newStatus);
	}
 
	skipPauseDownload() {
		this.setState({ skipPause: true });
		this.setStatus(NDCProgressBar.STATUS.DOWNLOADING);
	}
 
	skipToIndex() {
		const index = this.skipInput ? Number.parseInt(this.skipInput.value) : 0;
		if (index > this.state.progress && index <= this.state.modsCount) {
			this.setState({ skipTo: true, skipToIndex: index });
			this.setStatus(NDCProgressBar.STATUS.DOWNLOADING);
		}
	}
 
	/**
	 * Updates the current state with the provided new state and triggers a re-render.
	 *
	 * @param {Object} newState - An object containing the properties to update in the current state.
	 */
	setState(newState) {
		Object.assign(this.state, newState);
		this.render();
	}
 
	/**
	 * Updates the state with the given number of mods.
	 *
	 * @param {number} count - The number of mods to set.
	 */
	setModsCount(count) {
		this.setState({ modsCount: count });
	}
 
	/**
	 * Updates the progress state with the given value.
	 *
	 * @param {number} progress - The current progress value to set.
	 */
	setProgress(progress) {
		this.setState({ progress });
	}
 
	incrementProgress() {
		this.setProgress(this.state.progress + 1);
	}
 
	/**
	 * Updates the status of the progress bar and its associated text content.
	 *
	 * @param {number} status - The new status to set. This should correspond to a key in `NDCProgressBar.STATUS_TEXT`.
	 */
	setStatus(status) {
		this.setState({ status });
		if (this.statusText) {
			this.statusText.textContent = NDCProgressBar.STATUS_LABEL[status];
		}
	}
 
	getProgressPercent() {
		return ((this.state.progress / this.state.modsCount) * 100).toFixed(2);
	}
 
	render() {
		const percent = this.getProgressPercent();
		if (this.progressFill) {
			this.progressFill.style.width = `${percent}%`;
		}
		if (this.progressText) {
			this.progressText.textContent = `${percent}%`;
		}
		if (this.countText) {
			this.countText.textContent = `${this.state.progress}/${this.state.modsCount}`;
		}
 
		if (this.pauseBtn) {
			this.pauseBtn.innerHTML = this.state.status === NDCProgressBar.STATUS.PAUSED
				? '<svg style="width: 1.5rem; height: 1.5rem;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path style="fill: currentcolor;" d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>'
				: '<svg style="width: 1.5rem; height: 1.5rem;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path style="fill: currentcolor;" d="M14,19H18V5H14M6,19H10V5H6V19Z"/></svg>';
		}
	}
}
 
class NDCSelectModsModal {
	/** @type {HTMLElement | null} */ dropdown
	/** @type {HTMLButtonElement | null} */ dropdownBtn
	/** @type {HTMLElement | null} */ modsList
	/** @type {HTMLElement | null} */ selectedCount
	/** @type {HTMLInputElement | null} */ searchInput
	/** @type {HTMLSelectElement | null} */ sortSelect
	/** @type {HTMLButtonElement | null} */ cancelBtn
	/** @type {HTMLButtonElement | null} */ downloadBtn
 
	/** @param {NDC} ndc */
	constructor(ndc) {
		this.ndc = ndc;
		this.element = this.createElement();
		this.setupElements();
		this.attachBasicListeners();
	}
 
	createElement() {
		const div = document.createElement("div");
		div.className = "ndc-modal-backdrop";
		div.innerHTML = `
		<div class="ndc-modal">
			<div class="ndc-modal-header">
				<h2 class="ndc-modal-header-title">Select mods</h2>
				<div style="display: flex; gap: .5rem;">
					<div style="display: flex; align-items: center;">
						<span class="ndc:badge-primary">0 mods selected</span>
					</div>
					<div style="position: relative;">
						<button class="ndc:btn-outline-secondary ndc-modal-header-dropdown-btn">
							<svg style="width: 1.5rem; height: 1.5rem; fill: currentcolor;"
									xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
								<path d="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z"/>
							</svg>
						</button>
						<div class="ndc-dropdown">
							<button class="ndc-dropdown-item ndc-select-all">Select all<svg style="width: 1.5rem; height: 1.5rem;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill: currentcolor;" d="M0.41,13.41L6,19L7.41,17.58L1.83,12M22.24,5.58L11.66,16.17L7.5,12L6.07,13.41L11.66,19L23.66,7M18,7L16.59,5.58L10.24,11.93L11.66,13.34L18,7Z"/></svg></button>
							<button class="ndc-dropdown-item ndc-deselect-all">Deselect all<svg style="width: 1.5rem; height: 1.5rem;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill: currentcolor;" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg></button>
							<button class="ndc-dropdown-item ndc-invert-selection">Invert selection<svg style="width: 1.5rem; height: 1.5rem;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill: currentcolor;" d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M6.5 9L10 5.5L13.5 9H11V13H9V9H6.5M17.5 15L14 18.5L10.5 15H13V11H15V15H17.5Z"/></svg></button>
							<div class="border-t border-stroke-subdued"></div>
							<button class="ndc-dropdown-item">Export mods selection<svg style="width: 1.5rem; height: 1.5rem;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill: currentcolor;" d="M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z"/></svg></button>
							<button class="ndc-dropdown-item">Import mods selection<svg style="width: 1.5rem; height: 1.5rem;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill: currentcolor;" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/></svg></button>
							<div class="border-t border-stroke-subdued"></div>
							<button class="ndc-dropdown-item">Import downloaded mods<svg style="width: 1.5rem; height: 1.5rem;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill: currentcolor;" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/></svg></button>
						</div>
					</div>
				</div>
			</div>
			<div class="ndc-modal-filter">
				<input type="search" placeholder="Search mods...">
				<select>
					<option value="mod_name_asc">Order by mod name ASC</option>
					<option value="mod_name_desc">Order by mod name DESC</option>
					<option value="file_name_asc">Order by file name ASC</option>
					<option value="file_name_desc">Order by file name DESC</option>
					<option value="size_asc">Order by size ASC</option>
					<option value="size_desc">Order by size DESC</option>
				</select>
			</div>
			<div class="ndc-modal-mods-list">
				<div class="ndc-modal-mods-list-header">
					<span style="width: 3rem;">Index</span>
					<span style="flex: 1;">Mod name</span>
					<span style="flex: 1;">File name</span>
					<span style="width: 5rem;">Size</span>
				</div>
				<div class="ndc-modal-mods-list-body"></div>
			</div>
			<div class="ndc-modal-actions">
				<button class="ndc:btn-outline-secondary ndc-modal-cancel">Cancel</button>
				<button class="ndc:btn-primary ndc-modal-download">Download selected mods</button>
			</div>
		</div>
	`;
		return div;
	}
 
	setupElements() {
		this.selectedCount = this.element.querySelector(".ndc\\:badge-primary");
		this.dropdownBtn = this.element.querySelector(".ndc-modal-header-dropdown-btn");
		this.dropdown = this.element.querySelector(".ndc-dropdown");
		this.selectAllBtn = this.dropdown?.querySelector(".ndc-select-all");
		this.deselectAllBtn = this.dropdown?.querySelector(".ndc-deselect-all");
		this.invertBtn = this.dropdown?.querySelector(".ndc-invert-selection");
		this.exportBtn = this.dropdown?.querySelector(".ndc-dropdown-item:nth-child(5)");
		this.importBtn = this.dropdown?.querySelector(".ndc-dropdown-item:nth-child(6)");
		this.importDownloadedBtn = this.dropdown?.querySelector(".ndc-dropdown-item:nth-child(8)");
		this.searchInput = this.element.querySelector("input[type='search']");
		this.sortSelect = this.element.querySelector("select");
		this.modsList = this.element.querySelector(".ndc-modal-mods-list-body");
		this.cancelBtn = this.element.querySelector(".ndc-modal-cancel");
		this.downloadBtn = this.element.querySelector(".ndc-modal-download");
	}
 
	attachBasicListeners() {
		this.dropdownBtn?.addEventListener("click", () => this.toggleDropdown());
		this.cancelBtn?.addEventListener("click", () => this.element.remove());
		this.downloadBtn?.addEventListener("click", () => this.downloadSelected());
		document.addEventListener("click", (e) => this.closeDropdownOnOutsideClick(e));
	}
 
	toggleDropdown() {
		if (this.dropdown) {
			this.dropdown.style.display = this.dropdown.style.display === "block" ? "none" : "block";
		}
	}
 
	/**
	 * Handles the closing of a dropdown menu when a click occurs outside of the dropdown button.
	 *
	 * @param {MouseEvent} event - The mouse event triggered by the user's click.
	 */
	closeDropdownOnOutsideClick(event) {
		if (this.dropdownBtn && event.target instanceof Node && !this.dropdownBtn.contains(event.target) && this.dropdown) {
			this.dropdown.style.display = "none";
		}
	}
 
	downloadSelected() {
		const selectedMods = this.ndc.mods.filter((mod) => {
			/** @type {HTMLInputElement|null} */
			const checkbox = this.element.querySelector(`#mod_${mod.fileId}`);
			if (checkbox) {
				return checkbox.checked;
			}
			return false;
		});
		this.element.remove();
		this.ndc.downloadMods(selectedMods);
	}
 
	/**
	 * Updates the mod list displayed in the UI with the provided mods data.
	 *
	 * @param {Mod[]} mods - The list of mods to display.
	 */
	updateModList(mods) {
		if (this.modsList) {
			// Save the checked state of checkboxes
			const checkedStates = {};
			this.modsList.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
				if (checkbox instanceof HTMLInputElement) {
					checkedStates[checkbox.id] = checkbox.checked;
				}
			});
 
			// Update the mods list
			this.modsList.innerHTML = mods.map((mod, index) => `
				<div class="ndc-modal-mods-list-body-row">
					<input type="checkbox" id="mod_${mod.fileId}" style="display: none;">
					<div class="ndc:hidden ndc:sm:flex ndc:sm:gap-0.5">
						<span style="width: 3rem;" class="ndc:text-primary mod-list-index">#${index + 1}</span>
						<span style="flex: 1;" class="ndc:text-white">${mod.modName}</span>
						<span style="flex: 1;" class="ndc:text-white">${mod.fileName}</span>
						<span style="width: 5rem;" class="ndc:text-white">${convertSize(mod.size)}</span>
					</div>
					<div class="ndc:block ndc:sm:hidden">
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
							<div style="display: flex; item-align: center; gap: 0.5rem;">
								<span class="ndc:text-primary mod-list-index">#${index + 1}</span>
							</div>
							<div style="display: flex; gap: 0.5rem;">
								<span class="ndc:text-white">${convertSize(mod.size)}</span>
							</div>
						</div>
						<div style="display: flex; flex-direction: column; gap: 0.25rem;">
							<div class="ndc:text-white">${mod.modName}</div>
							<div class="ndc:text-white">${mod.fileName}</div>
						</div>
					</div>
				</div>
			`).join("");
 
			// Restore the checked state of checkboxes
			this.modsList.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
				if (checkedStates[checkbox.id] !== undefined && checkbox instanceof HTMLInputElement) {
					checkbox.checked = checkedStates[checkbox.id];
					const parentElement = checkbox.parentElement;
					if (parentElement) {
						this.toggleRowSelection(parentElement, checkbox.checked);
					}
				}
			});
 
			// Reattach event listeners
			this.modsList.querySelectorAll(".ndc-modal-mods-list-body-row").forEach(row => {
				row.addEventListener("click", (e) => this.handleModClick(row, e));
			});
		}
	}
 
	/**
	 * Handles the click event on a mod row, toggling its selection state and updating the UI accordingly.
	 * Supports shift-click functionality for selecting multiple rows at once.
	 *
	 * @param {HTMLElement|Element} row - The table row element representing the mod that was clicked.
	 * @param {MouseEvent|Event} event - The mouse event triggered by the click.
	 */
	handleModClick(row, event) {
		const checkbox = row.querySelector("input");
		if (checkbox) {
			checkbox.checked = !checkbox.checked;
			this.toggleRowSelection(row, checkbox.checked);
		}
 
		if (event instanceof MouseEvent && event.shiftKey && this.modsList?.dataset.lastChecked) {
			this.handleShiftSelection(row);
		}
 
		if (this.modsList) {
			this.modsList.dataset.lastChecked = Array.from(this.modsList.children).indexOf(row).toString();
		}
		this.updateSelectedCount();
	}
 
	/**
	 * Toggles the checkbox state for a given mod and updates the row selection accordingly.
	 *
	 * @param {Mod} mod - The mod object containing information about the mod, including its fileId.
	 * @param {boolean} [checked] - A boolean indicating whether the checkbox should be checked (true) or unchecked (false).
	 * @returns {{ row: HTMLElement, checkbox: HTMLInputElement } | null}
	 *          An object containing the row element and the checkbox element, or null if not found.
	 */
	toggleModCheckbox(mod, checked) {
		const parentNode = this.element.querySelector(`#mod_${mod.fileId}`)?.parentNode;
		const row = parentNode instanceof HTMLElement ? parentNode : null;
		if (!row) return null;
 
		const checkbox = row?.querySelector("input");
		if (!checkbox) return null;
		checkbox.checked = checked !== undefined ? checked : !checkbox.checked;
 
		this.toggleRowSelection(row, checkbox.checked);
		this.updateSelectedCount();
 
		return { row, checkbox };
	};
 
	/**
	 * Toggles the selection state of a table row by adding or removing specific CSS classes.
	 *
	 * @param {HTMLElement | Element} row - The table row element to toggle selection for.
	 * @param {boolean | undefined} checked - A boolean indicating whether the row should be marked as selected (true) or deselected (false).
	 */
	toggleRowSelection(row, checked) {
		row.classList.toggle("ndc:bg-primary-subdued", checked);
		const modListIndexes = row.querySelectorAll(".mod-list-index");
		modListIndexes.forEach((modListIndex) => {
			modListIndex.classList.toggle("ndc:text-primary", !checked);
			modListIndex.classList.toggle("ndc:text-white", checked);
		});
	}
 
	/**
	 * Handles the selection of multiple rows in a list when the Shift key is pressed.
	 * Toggles the checked state and applies/removes CSS classes for styling based on the state.
	 *
	 * @param {HTMLElement|Element} row - The row element where the Shift+click event occurred.
	 */
	handleShiftSelection(row) {
		const start = this.modsList ? Array.from(this.modsList.children).indexOf(row) : -1;
		const end = this.modsList ? Number(this.modsList.dataset.lastChecked) : -1;
		const child = this.modsList?.children[end];
		const input = child?.querySelector("input");
		const checked = input?.checked || false;
 
		for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
			const modRow = this.modsList ? this.modsList.children[i] : null;
			const checkbox = modRow ? modRow.querySelector("input") : null;
			if (checkbox) {
				checkbox.checked = checked;
			}
			if (modRow) {
				this.toggleRowSelection(modRow, checked);
			}
		}
	}
 
	updateSelectedCount() {
		const count = this.element.querySelectorAll("input:checked").length;
		if (this.selectedCount) {
			this.selectedCount.textContent = `${count} mods selected`;
		}
	}
 
	render() {
		this.updateModList(this.ndc.mods);
		this.element.addEventListener("click", (e) => {
			if (e.target === this.element) this.element.remove();
		});
 
		this.searchInput?.addEventListener("input", () => this.filterMods());
		this.sortSelect?.addEventListener("change", () => this.sortMods());
		this.selectAllBtn?.addEventListener("click", () => this.selectAll());
		this.deselectAllBtn?.addEventListener("click", () => this.deselectAll());
		this.invertBtn?.addEventListener("click", () => this.invertSelection());
		this.exportBtn?.addEventListener("click", () => this.exportSelection());
		this.importBtn?.addEventListener("click", () => this.importSelection());
		this.importDownloadedBtn?.addEventListener("click", () => this.importDownloaded());
	}
 
	filterMods() {
		const search = this.searchInput?.value.toLowerCase();
		// split the search string into words
		const searchWords = search ? search.split(" ") : [];
		// check if any of the words are present in the mod name or file name
		if (searchWords.length > 0) {
			this.ndc.mods.forEach((mod) => {
				const row = this.element.querySelector(`#mod_${mod.fileId}`);
				const parentNode = row?.parentNode instanceof HTMLElement ? row.parentNode : null;
				if (parentNode) {
					// parentNode.style.display = (mod.modName.toLowerCase().includes(search) ||
					// 	mod.fileName.toLowerCase().includes(search)) ? "" : "none";
					const matches = searchWords.every(word =>
						mod.modName.toLowerCase().includes(word) ||
						mod.fileName.toLowerCase().includes(word));
					parentNode.style.display = matches ? "" : "none";
				}
			});
		}
	}
 
	sortMods() {
		const sort = this.sortSelect?.value;
		const mods = [...this.ndc.mods].sort((a, b) => {
			switch (sort) {
				case "mod_name_asc": return a.modName.localeCompare(b.modName);
				case "mod_name_desc": return b.modName.localeCompare(a.modName);
				case "file_name_asc": return a.fileName.localeCompare(b.fileName);
				case "file_name_desc": return b.fileName.localeCompare(a.fileName);
				case "size_asc": return a.size - b.size;
				case "size_desc": return b.size - a.size;
				default: return 0;
			}
		});
		this.updateModList(mods);
	}
 
	selectAll() { this.toggleAllCheckboxes(true); }
 
	deselectAll() { this.toggleAllCheckboxes(false); }
 
	invertSelection() {
		this.ndc.mods.forEach((mod) => this.toggleModCheckbox(mod));
	}
 
	/**
	 * Toggles the state of all checkboxes in the mod list and updates the corresponding row styles.
	 *
	 * @param {boolean} state - The desired state for all checkboxes (true for checked, false for unchecked).
	 */
	toggleAllCheckboxes(state) {
		this.ndc.mods.forEach((mod) => this.toggleModCheckbox(mod, state));
	}
 
	exportSelection() {
		const selectedMods = this.ndc.mods.filter((mod) => {
			/** @type {HTMLInputElement|null} */
			const row = this.element.querySelector(`#mod_${mod.fileId}`);
			return row && row.checked
		});
		if (!selectedMods.length) return alert("You must select at least one mod to export.");
 
		const blob = new Blob([JSON.stringify(selectedMods, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `ndc_selected_mods_${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
 
	importSelection() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.addEventListener("change", () => {
			const reader = new FileReader();
			reader.onload = () => {
 
				const result = reader.result;
				if (typeof result !== "string") {
					console.error("Unexpected reader result type: " + typeof result);
					return;
				}
 
				const mods = JSON.parse(result);
				mods.forEach((/** @type {Mod} */ mod) => this.toggleModCheckbox(mod, true));
			};
			if (input.files && input.files[0]) {
				reader.readAsText(input.files[0]);
			} else {
				console.error("No file selected or input.files is null.");
			}
		});
		input.click();
	}
 
	importDownloaded() {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.addEventListener("change", () => {
			const files = input.files ? Array.from(input.files) : [];
			const downloaded = this.ndc.mods.filter(mod =>
				files.some(file => file.name.includes(mod.fileName)));
			const notDownloaded = this.ndc.mods.filter(mod => !downloaded.includes(mod));
 
			notDownloaded.forEach((mod) => this.toggleModCheckbox(mod, true));
 
			this.updateSelectedCount();
			alert(notDownloaded.length ?
				`Selected ${notDownloaded.length} mods not yet downloaded.` :
				"All mods are already downloaded.");
		});
		input.click();
	}
}
 
class NDCLogConsole {
	/**
	 * An enumeration representing different types of messages.
	 * @enum {string}
	 * @property {string} NORMAL - Represents a normal message type.
	 * @property {string} ERROR - Represents an error message type.
	 * @property {string} INFO - Represents an informational message type.
	 */
	static TYPE = {
		NORMAL: "NORMAL",
		ERROR: "ERROR",
		INFO: "INFO"
	};
 
	/** @type {boolean} */ hidden = false
	/** @type {HTMLButtonElement | null} */ toggleBtn
	/** @type {HTMLElement | null} */ logContainer
 
	/** @param {NDC} ndc */
	constructor(ndc) {
		this.ndc = ndc;
		this.element = this.createElement();
		this.setupElements();
		this.attachEventListeners();
	}
 
	createElement() {
		const div = document.createElement("div");
		Object.assign(div.style, {
			display: "flex",
			flexDirection: "column",
			width: "100%",
			gap: "1rem",
			marginTop: "1rem"
		});
 
		div.innerHTML = `
		<div style="display: flex; flex-direction: column; width: 100%; gap: 0.75rem;">
			<button style="background: none; border: 0; color: rgb(244, 244, 245); cursor: pointer;
							font: 400 16px/24px 'Montserrat', sans-serif; height: 24px; width: 100%;">
				Hide logs
			</button>
			<div style="background: rgb(29 29 33 / 70%); border: 1px solid rgb(255, 255, 255);
						border-radius: 4px; color: rgb(255, 255, 255);
						font: 600 14px/21px monospace; height: 160px;
						overflow-y: auto; resize: vertical; width: 100%;">
			</div>
		</div>
	`;
		return div;
	}
 
	setupElements() {
		this.toggleBtn = this.element.querySelector("button");
		this.logContainer = this.element.querySelector("div > div:nth-child(2)");
	}
 
	attachEventListeners() {
		this.toggleBtn?.addEventListener("click", () => this.toggleVisibility());
	}
 
	toggleVisibility() {
		this.hidden = !this.hidden;
		if (this.logContainer) {
			this.logContainer.style.display = this.hidden ? "none" : "";
		}
		if (this.toggleBtn) {
			this.toggleBtn.textContent = this.hidden ? "Show logs" : "Hide logs";
		}
	}
 
	/**
	 * Logs a message to the custom log console and the browser console.
	 *
	 * @param {string} message - The message to log.
	 * @param {string} [type=NDCLogConsole.TYPE.NORMAL] - The type of log message.
	 *        Can be one of the following:
	 *        - `NDCLogConsole.TYPE.NORMAL` (default): Standard log message.
	 *        - `NDCLogConsole.TYPE.ERROR`: Error message, styled in red.
	 *        - `NDCLogConsole.TYPE.INFO`: Informational message, styled in blue.
	 * @returns {HTMLDivElement} The created log row element.
	 */
	log(message, type = NDCLogConsole.TYPE.NORMAL) {
		const row = document.createElement("div");
		Object.assign(row.style, {
			display: "flex",
			gap: "0.25rem",
			padding: "0 0.5rem",
			...(type === NDCLogConsole.TYPE.ERROR && { color: "rgb(229, 62, 62)" }),
			...(type === NDCLogConsole.TYPE.INFO && { color: "rgb(96, 165, 250)" })
		});
 
		row.innerHTML = `<span>[${new Date().toLocaleTimeString()}]</span><span>${message}</span>`;
		if (this.logContainer) {
			this.logContainer.appendChild(row);
			this.logContainer.scrollTop = this.logContainer.scrollHeight;
		}
		console.log(message);
 
		return row;
	}
 
	/**
	 * Logs a message with the normal log type.
	 *
	 * @param {string} message - The message to be logged.
	 * @returns {HTMLDivElement}
	 */
	logNormal(message) {
		return this.log(message, NDCLogConsole.TYPE.NORMAL);
	}
 
	/**
	 * Logs an error message to the console with the error log type.
	 *
	 * @param {string} message - The error message to be logged.
	 * @returns {HTMLDivElement}
	 */
	logError(message) {
		return this.log(message, NDCLogConsole.TYPE.ERROR);
	}
 
	/**
	 * Logs an informational message to the console.
	 *
	 * @param {string} message - The message to be logged.
	 * @returns {HTMLDivElement} The result of the log operation.
	 */
	logInfo(message) {
		return this.log(message, NDCLogConsole.TYPE.INFO);
	}
 
	clear() {
		if (this.logContainer) {
			this.logContainer.innerHTML = "";
		}
	}
}
 
let ndc = null;
 
setInterval(() => {
    if (window.location.href === "https://www.nexusmods.com/") {
        if (!ndc || (ndc instanceof NDC && !document.contains(ndc.element))) {
            ndc = new NDC(); // If NDC is async, await it if needed: await new NDC()
            document.querySelector("#mainContent > div > div.next-container > section")
                ?.prepend(ndc.element);
        }
    }
}, 500);
})();
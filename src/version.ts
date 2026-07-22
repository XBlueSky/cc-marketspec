export const LEGACY_FORMAT_VERSION = '1.0' as const;
export const CURRENT_FORMAT_VERSION = '1.1' as const;

export type AuthoredLayout = 'legacy' | 'namespaced';
export type VersionCheck =
	| { ok: true; version: typeof LEGACY_FORMAT_VERSION | typeof CURRENT_FORMAT_VERSION; warning?: string }
	| { ok: false; error: string };

const FORMAT = /^(\d+)\.(\d+)$/;

type ParsedFormatVersion =
	| { ok: true; value: string; major: number; minor: number }
	| { ok: false; error: string };
type VersionFailure = Extract<VersionCheck, { ok: false }>;

function parseFormatVersion(value: unknown): ParsedFormatVersion {
	if (typeof value !== 'string') {
		return { ok: false, error: 'schemaVersion must be a string in MAJOR.MINOR form' };
	}
	const match = FORMAT.exec(value);
	if (!match) return { ok: false, error: `schemaVersion "${value}" must use MAJOR.MINOR form` };
	return { ok: true, value, major: Number(match[1]), minor: Number(match[2]) };
}

function rejectUnsupported({ major, minor }: { major: number; minor: number }): VersionFailure | null {
	if (major !== 1) return { ok: false, error: `unsupported format major ${major}; install a compatible cc-marketspec` };
	if (minor > 1) return { ok: false, error: `future format minor ${minor}; upgrade cc-marketspec` };
	return null;
}

export function checkFormatVersion(value: unknown, layout: AuthoredLayout): VersionCheck {
	const parsed = parseFormatVersion(value);
	if (!parsed.ok) return parsed;
	const unsupported = rejectUnsupported(parsed);
	if (unsupported) return unsupported;

	const required = layout === 'legacy' ? LEGACY_FORMAT_VERSION : CURRENT_FORMAT_VERSION;
	if (parsed.value !== required) {
		return { ok: false, error: `${layout} layout requires schemaVersion ${required}; found ${parsed.value}` };
	}
	return layout === 'legacy'
		? { ok: true, version: LEGACY_FORMAT_VERSION, warning: 'legacy schemaVersion 1.0 is deprecated; run cc-marketspec migrate' }
		: { ok: true, version: CURRENT_FORMAT_VERSION };
}

export function checkManifestFormatVersion(value: unknown): VersionCheck {
	const parsed = parseFormatVersion(value);
	if (!parsed.ok) return parsed;
	const unsupported = rejectUnsupported(parsed);
	if (unsupported) return unsupported;
	if (parsed.value === LEGACY_FORMAT_VERSION) {
		return {
			ok: true,
			version: LEGACY_FORMAT_VERSION,
			warning: 'manifest schemaVersion 1.0 is deprecated; prefer a format 1.1 producer'
		};
	}
	if (parsed.value === CURRENT_FORMAT_VERSION) {
		return { ok: true, version: CURRENT_FORMAT_VERSION };
	}
	return {
		ok: false,
		error: `unsupported format version ${parsed.value}; supported versions are ${LEGACY_FORMAT_VERSION} and ${CURRENT_FORMAT_VERSION}`
	};
}

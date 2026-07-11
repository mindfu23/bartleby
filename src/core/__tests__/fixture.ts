/**
 * Synthetic Scrivener 3 fixture for unit tests. Modeled on the real on-disk
 * structure described in phase0-handoff §4. This does NOT replace the manual
 * verification gates against desktop Scrivener — it only locks in the
 * automatable invariants.
 */

export const UUID_DRAFT = '11111111-1111-1111-1111-111111111111'
export const UUID_SCENE1 = '22222222-2222-2222-2222-222222222222'
export const UUID_SCENE2 = '33333333-3333-3333-3333-333333333333'
export const UUID_RESEARCH = '44444444-4444-4444-4444-444444444444'
export const UUID_TRASH = '55555555-5555-5555-5555-555555555555'
export const UUID_EMPTY = '66666666-6666-6666-6666-666666666666'

export const SCENE1_RTF =
  `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}\r\n` +
  `{\\colortbl ;\\red0\\green0\\blue0;}\r\n` +
  `{\\*\\generator Riched20 10.0;}\\viewkind4\\uc1 \r\n` +
  `\\pard\\sa200\\sl276\\slmult1\\f0\\fs22\\lang9 Hello world, this is \\b bold\\b0  and \\i italic\\i0  text.\\par\r\n` +
  `Caf\\'e9 and M\\u252?ller visited.\\par\r\n` +
  `}\r\n`

export const SCENE1_TEXT =
  'Hello world, this is bold and italic text.\nCafé and Müller visited.\n'

export const SCENE2_RTF =
  `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}\r\n` +
  `\\pard\\f0\\fs22 Second scene body.\\par\r\n` +
  `}\r\n`

export const SCENE2_TEXT = 'Second scene body.\n'

export const SCRIVX = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject Template="No" Version="2.0" Identifier="AAAAAAAA-0000-0000-0000-000000000000" Creator="SCRWIN-3.1.5.1" Device="TestDevice" Modified="2025-03-14 22:15:28 -0600" ModID="B4A944C3-1111-2222-3333-444444444444">
    <Binder>
        <BinderItem UUID="${UUID_DRAFT}" Type="DraftFolder" Created="2025-03-14 22:15:17 -0600" Modified="2025-03-14 22:15:17 -0600">
            <Title>Draft</Title>
            <MetaData>
                <IncludeInCompile>Yes</IncludeInCompile>
            </MetaData>
            <Children>
                <BinderItem UUID="${UUID_SCENE1}" Type="Text" Created="2025-03-14 22:15:20 -0600" Modified="2025-03-14 22:15:20 -0600">
                    <Title>Scene One</Title>
                    <MetaData>
                        <IncludeInCompile>Yes</IncludeInCompile>
                    </MetaData>
                </BinderItem>
                <BinderItem UUID="${UUID_SCENE2}" Type="Text" Created="2025-03-14 22:15:21 -0600" Modified="2025-03-14 22:15:21 -0600">
                    <Title>Scene Two &amp; Friends</Title>
                    <MetaData>
                        <IncludeInCompile>Yes</IncludeInCompile>
                    </MetaData>
                </BinderItem>
                <BinderItem UUID="${UUID_EMPTY}" Type="Text" Created="2025-03-14 22:15:22 -0600" Modified="2025-03-14 22:15:22 -0600">
                    <Title>Empty Scene</Title>
                    <MetaData>
                        <IncludeInCompile>Yes</IncludeInCompile>
                    </MetaData>
                </BinderItem>
            </Children>
        </BinderItem>
        <BinderItem UUID="${UUID_RESEARCH}" Type="ResearchFolder" Created="2025-03-14 22:15:17 -0600" Modified="2025-03-14 22:15:17 -0600">
            <Title>Research</Title>
            <MetaData>
                <IncludeInCompile>No</IncludeInCompile>
            </MetaData>
        </BinderItem>
        <BinderItem UUID="${UUID_TRASH}" Type="TrashFolder" Created="2025-03-14 22:15:17 -0600" Modified="2025-03-14 22:15:17 -0600">
            <Title>Trash</Title>
        </BinderItem>
    </Binder>
</ScrivenerProject>
`

export function fixtureFiles(rootPrefix = 'Baseline.scriv/'): Map<string, Uint8Array> {
  const enc = new TextEncoder()
  const latin1 = (s: string) => {
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
    return out
  }
  const files = new Map<string, Uint8Array>()
  files.set(`${rootPrefix}Baseline.scrivx`, enc.encode(SCRIVX))
  files.set(`${rootPrefix}Files/Data/${UUID_SCENE1}/content.rtf`, latin1(SCENE1_RTF))
  files.set(`${rootPrefix}Files/Data/${UUID_SCENE2}/content.rtf`, latin1(SCENE2_RTF))
  files.set(`${rootPrefix}version.txt`, enc.encode('16'))
  // Cache files at their real on-disk locations (docs.checksum lives under
  // Files/Data/, the rest under Files/).
  files.set(`${rootPrefix}Files/Data/docs.checksum`, enc.encode('fake-checksum'))
  files.set(`${rootPrefix}Files/search.indexes`, enc.encode('fake-index'))
  files.set(`${rootPrefix}Files/binder.autosave`, enc.encode('fake'))
  files.set(`${rootPrefix}Files/binder.backup`, enc.encode('fake'))
  return files
}

/** Generates a ZSH completion script for the blockfont CLI. */
export function generateZshCompletion(): string {
  return `#compdef blockfont

_blockfont_presets=(
  'ascii:128 standard ASCII characters (U+0020..U+007E)'
  'latin:All European Latin alphabets with accents + ASCII'
  'cyrillic:Cyrillic alphabet (Russian, Ukrainian, Bulgarian, Serbian...) + ASCII'
  'greek:Greek alphabet + ASCII'
  'arabic:Arabic script + ASCII'
  'hebrew:Hebrew script + ASCII'
  'devanagari:Devanagari script (Hindi, Sanskrit...) + ASCII'
  'thai:Thai script + ASCII'
  'korean:Korean Hangul syllables + ASCII'
  'japanese:Japanese Hiragana, Katakana, Kanji + ASCII'
  'chinese:Chinese CJK Unified Ideographs + ASCII'
  'symbols:Math, Braille, Box drawing, Emojis + ASCII'
  'all:Full Minecraft asset discovery'
)

_blockfont_styles=(
  'regular:Standard regular weight and style'
  'bold:Bold variant'
  'italic:Italic variant'
  'bold-italic:Bold italic variant'
)

_blockfont_formats=(
  'woff:Web Open Font Format 1.0 (compressed, web recommended)'
  'ttf:TrueType Font binary'
  'otf:OpenType Font binary'
  'ttc:TrueType Collection multi-style font binary'
)

_blockfont() {
  local curcontext="$curcontext" state line
  typeset -A opt_args

  _arguments -C \\
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      local -a commands
      commands=(
        'generate:Generate OpenType/WOFF font files for specified character presets'
        'presets:List all available character presets with Unicode ranges and counts'
        'completion:Generate ZSH completion script for zsh-autocomplete'
      )
      _describe -t commands 'blockfont subcommands' commands
      ;;
    args)
      case $line[1] in
        generate)
          _arguments \\
            '-v[Minecraft asset version (e.g. 1.21)]:version:' \\
            '--version[Minecraft asset version (e.g. 1.21)]:version:' \\
            '-o[Output directory for generated font files]:directory:_files -/' \\
            '--output[Output directory for generated font files]:directory:_files -/' \\
            '-f[Font export format (ttf, otf, woff, ttc)]:format:_describe -t formats "font format" _blockfont_formats' \\
            '--format[Font export format (ttf, otf, woff, ttc)]:format:_describe -t formats "font format" _blockfont_formats' \\
            '-s[Font style (regular, bold, italic, bold-italic)]:style:_describe -t styles "font style" _blockfont_styles' \\
            '--style[Font style (regular, bold, italic, bold-italic)]:style:_describe -t styles "font style" _blockfont_styles' \\
            '-e[Styles to exclude from TTC collection]:exclude:_describe -t styles "exclude style" _blockfont_styles' \\
            '--exclude[Styles to exclude from TTC collection]:exclude:_describe -t styles "exclude style" _blockfont_styles' \\
            '-a[Root directory for Minecraft assets]:directory:_files -/' \\
            '--assets[Root directory for Minecraft assets]:directory:_files -/' \\
            '*:presets:_describe -t presets "character preset" _blockfont_presets'
          ;;
        presets|list)
          ;;
        completion)
          _values 'shell' 'zsh' 'bash'
          ;;
      esac
      ;;
  esac
}

_blockfont "$@"
`;
}

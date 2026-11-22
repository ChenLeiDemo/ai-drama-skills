#!/usr/bin/env bash
# 把本仓库的 skill 装到本地 agent 的 skills 目录。
# 默认软链（git pull 之后立刻生效）；系统不给建软链时自动退化为复制，并明确告诉你。
#
#   ./scripts/install.sh                   自动探测已装的 agent，装全部 skill
#   ./scripts/install.sh --list            只列各 agent 的路径与探测结果
#   ./scripts/install.sh --pi              装到 pi（可以给多个：--pi --claude）
#   ./scripts/install.sh --all             所有已知 agent 都装（跳过探测）
#   ./scripts/install.sh novel-characters  只装某一个（可多个）
#   ./scripts/install.sh --copy            强制复制（Windows 常见，见下）
#   ./scripts/install.sh --uninstall       取消软链（真实目录不动）
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO/skills"

# 已知 agent → 用户级 skills 目录。路径按各家官方文档，改之前先确认。
#   claude    ~/.claude/skills            Claude Code
#   codex     ~/.codex/skills             Codex
#   pi        ~/.pi/agent/skills          pi（settings.json 的 skills 里没配路径时装这儿）
#   gemini    ~/.gemini/skills            Gemini CLI（同时也读 ~/.agents/skills）
#   opencode  ~/.config/opencode/skills   OpenCode（同时也读 ~/.claude、~/.agents）
#   agents    ~/.agents/skills            Agent Skills 规范的通用位置（Zed 只认这个）
#   amp       ~/.config/agents/skills     Amp / Replit 的通用位置
known_agents=(claude codex pi gemini opencode agents amp)

agent_dir() {
  case "$1" in
    claude) echo "$HOME/.claude/skills" ;;
    codex) echo "$HOME/.codex/skills" ;;
    pi) echo "$HOME/.pi/agent/skills" ;;
    gemini) echo "$HOME/.gemini/skills" ;;
    opencode) echo "$HOME/.config/opencode/skills" ;;
    agents) echo "$HOME/.agents/skills" ;;
    amp) echo "$HOME/.config/agents/skills" ;;
    *) return 1 ;;
  esac
}

# 探测：父目录在，就认为这个 agent 装了
agent_present() {
  local d
  d="$(agent_dir "$1")"
  [ -d "$(dirname "$d")" ]
}

# 实测这个目录能不能建软链。git-bash / MSYS 在没有开发者模式时会「假装成功」但实际复制，
# 所以不能看返回值，必须回读是不是真的软链。
symlink_ok() {
  local probe="$1/.ln-probe-$$"
  if ln -s "$SKILLS_DIR" "$probe" 2>/dev/null && [ -L "$probe" ]; then
    rm -f "$probe"
    return 0
  fi
  rm -rf "$probe" 2>/dev/null || true
  return 1
}

targets=()
wanted=()
uninstall=0
force_copy=0
list_only=0

for arg in "$@"; do
  case "$arg" in
    --uninstall) uninstall=1 ;;
    --copy) force_copy=1 ;;
    --list) list_only=1 ;;
    --all) for a in "${known_agents[@]}"; do targets+=("$a"); done ;;
    -h | --help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --*)
      name="${arg#--}"
      if ! agent_dir "$name" >/dev/null; then
        echo "未知选项 $arg。已知：${known_agents[*]}" >&2
        exit 1
      fi
      targets+=("$name")
      ;;
    *) wanted+=("$arg") ;;
  esac
done

if [ "$list_only" -eq 1 ]; then
  printf '%-10s %-36s %s\n' AGENT PATH 已装
  for a in "${known_agents[@]}"; do
    d="$(agent_dir "$a")"
    if agent_present "$a"; then mark="✓"; else mark="—"; fi
    printf '%-10s %-36s %s\n' "$a" "${d/#$HOME/~}" "$mark"
  done
  exit 0
fi

# 没指定就自动探测
if [ ${#targets[@]} -eq 0 ]; then
  for a in "${known_agents[@]}"; do
    agent_present "$a" && targets+=("$a")
  done
fi
if [ ${#targets[@]} -eq 0 ]; then
  echo "没探测到任何 agent。用 --list 看路径，或用 --pi / --claude / --codex … 指定。" >&2
  exit 1
fi

# 没指定 skill 就装全部（只认含 SKILL.md 的目录）
if [ ${#wanted[@]} -eq 0 ]; then
  for d in "$SKILLS_DIR"/*/; do
    [ -f "$d/SKILL.md" ] && wanted+=("$(basename "$d")")
  done
fi

for agent in "${targets[@]}"; do
  target="$(agent_dir "$agent")"
  mkdir -p "$target"
  echo "# $agent → ${target/#$HOME/~}"

  # 每个目标单独判定用软链还是复制
  use_copy="$force_copy"
  if [ "$uninstall" -eq 0 ] && [ "$use_copy" -eq 0 ]; then
    if ! symlink_ok "$target"; then
      use_copy=1
      echo "  ! 这个系统不给建软链（Windows 需要开发者模式），改为复制——仓库更新后要重跑一次" >&2
    fi
  fi

  for name in "${wanted[@]}"; do
    src="$SKILLS_DIR/$name"
    dst="$target/$name"
    if [ ! -f "$src/SKILL.md" ]; then
      echo "  ✗ $name — 不是一个 skill（缺 SKILL.md）" >&2
      exit 1
    fi

    if [ "$uninstall" -eq 1 ]; then
      if [ -L "$dst" ]; then
        rm "$dst"
        echo "  − $dst"
      elif [ -d "$dst" ]; then
        echo "  ! $dst 是真实目录（复制模式装的），没动它——要删就 rm -rf \"$dst\"" >&2
      fi
      continue
    fi

    if [ "$use_copy" -eq 1 ]; then
      # 合并式复制：可重复执行，不会删掉 dst 里的其他东西
      mkdir -p "$dst"
      cp -R "$src/." "$dst/"
      echo "  ✓ $dst（复制）"
      continue
    fi

    # 真实目录是用户自己放的，不覆盖
    if [ -e "$dst" ] && [ ! -L "$dst" ]; then
      echo "  ! $dst 已存在且不是软链，跳过" >&2
      continue
    fi
    ln -sfn "$src" "$dst"
    echo "  ✓ $dst → $src"
  done
done

if [ "$uninstall" -eq 0 ] && [ "$force_copy" -eq 1 ]; then
  echo ""
  echo "复制模式：仓库更新后重跑一次；--uninstall 不会删副本，需要自己 rm -rf。"
fi

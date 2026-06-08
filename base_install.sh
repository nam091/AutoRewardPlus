#!/usr/bin/env bash
# =============================================================================
#  setup_patchright_node.sh   (PHIÊN BẢN CHỈ DÀNH CHO NODE.JS)
# -----------------------------------------------------------------------------
#  Tự động: cài Node v24 (đặt làm mặc định) + Playwright + Patchright cho Node.js,
#  tải trình duyệt + OS deps, và tạo sẵn helper chạy HEADFUL (không headless).
#
#  Giải quyết cho anh:
#   1) Patchright KHÔNG nên dùng headless ("hidden") -> dễ bị phát hiện.
#      => helper run-stealth.sh chạy headful trong màn hình ảo Xvfb.
#   2) Cài hay hỏi prompt (Y/n, Enter, yes...) -> ép TOÀN BỘ non-interactive.
#
#  Hỗ trợ: Debian/Ubuntu (apt), Fedora/RHEL/Amazon (dnf/yum), Arch (pacman),
#          openSUSE (zypper). Tự nhận diện Google Colab.
#
#  Cách dùng:
#     chmod +x setup_patchright_node.sh
#     ./setup_patchright_node.sh                         # mặc định: chromium
#     BROWSERS="chromium firefox" ./setup_patchright_node.sh
#     PROJECT_DIR=/content/bot ./setup_patchright_node.sh
#     NODE_VERSION=24 ./setup_patchright_node.sh
# =============================================================================

set -Eeuo pipefail

# --------------------------------------------------------------------------- #
#  0. Cấu hình (override bằng biến môi trường)
# --------------------------------------------------------------------------- #
NODE_VERSION="${NODE_VERSION:-24}"          # phiên bản Node muốn cài & đặt mặc định
BROWSERS="${BROWSERS:-chromium}"            # trình duyệt (chromium firefox webkit)
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"        # thư mục dự án Node (nơi cài node_modules)
INSTALL_OS_DEPS="${INSTALL_OS_DEPS:-1}"     # =1 cài deps hệ điều hành cho trình duyệt
LOG_PREFIX="[setup]"

# Ép mọi thứ chạy không tương tác (tự động yes/Enter) -------------------------
export DEBIAN_FRONTEND=noninteractive
export DEBCONF_NONINTERACTIVE_SEEN=true
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1
export APT_LISTCHANGES_FRONTEND=none
export CI=1                                 # npm/npx tự bỏ prompt khi thấy CI=1
export npm_config_yes=true                  # npx không hỏi xác nhận
export npm_config_fund=false
export npm_config_audit=false
export npm_config_progress=false

# Phát hiện Google Colab (chỉ để log) ----------------------------------------
if [[ -n "${COLAB_RELEASE_TAG:-}" || -n "${COLAB_GPU:-}" || -d /content ]]; then IS_COLAB=1; else IS_COLAB=0; fi

# --------------------------------------------------------------------------- #
#  Tiện ích log + bắt lỗi
# --------------------------------------------------------------------------- #
log()  { printf '%s %s\n'  "$LOG_PREFIX" "$*"; }
warn() { printf '%s [!] %s\n' "$LOG_PREFIX" "$*" >&2; }
die()  { printf '%s [x] %s\n' "$LOG_PREFIX" "$*" >&2; exit 1; }
trap 'die "Lỗi ở dòng $LINENO. Đã dừng."' ERR

# --------------------------------------------------------------------------- #
#  sudo thông minh: chỉ dùng khi KHÔNG phải root
# --------------------------------------------------------------------------- #
SUDO=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    if sudo -n true 2>/dev/null; then SUDO="sudo -n"; else
      SUDO="sudo"; warn "sudo có thể hỏi mật khẩu 1 lần (không tránh được)."
    fi
  else
    warn "Không có sudo và không phải root: bỏ qua bước cài gói hệ thống."
  fi
fi

# --------------------------------------------------------------------------- #
#  1. Phát hiện trình quản lý gói
# --------------------------------------------------------------------------- #
PKG=""
for c in apt-get dnf yum pacman zypper; do
  command -v "$c" >/dev/null 2>&1 && { PKG="$c"; break; }
done
[[ -n "$PKG" ]] && log "Trình quản lý gói: $PKG" || warn "Không nhận diện được trình quản lý gói."
[[ "$IS_COLAB" == "1" ]] && log "Môi trường: Google Colab."

pkg_install() {
  [[ $# -eq 0 ]] && return 0
  [[ -z "$PKG" ]] && { warn "Bỏ qua cài gói: $*"; return 0; }
  case "$PKG" in
    apt-get)
      $SUDO apt-get update -y -q || true
      $SUDO apt-get install -y -q --no-install-recommends \
        -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" "$@"
      ;;
    dnf)    $SUDO dnf install -y -q "$@" ;;
    yum)    $SUDO yum install -y -q "$@" ;;
    pacman) $SUDO pacman -Sy --noconfirm --needed "$@" ;;
    zypper) $SUDO zypper --non-interactive install -y "$@" ;;
  esac
}

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
  else return 1; fi
}

# --------------------------------------------------------------------------- #
#  2. Công cụ nền: curl/git + Xvfb (cho headful ảo)
# --------------------------------------------------------------------------- #
log "Cài công cụ nền (curl, git, Xvfb...)"
case "$PKG" in
  apt-get) pkg_install curl ca-certificates git xvfb x11-utils ;;
  dnf|yum) pkg_install curl ca-certificates git xorg-x11-server-Xvfb xorg-x11-utils ;;
  pacman)  pkg_install curl ca-certificates git xorg-server-xvfb xorg-xdpyinfo ;;
  zypper)  pkg_install curl ca-certificates git xorg-x11-server xauth ;;
  *)       warn "Tự cài curl/git/xvfb thủ công nếu thiếu." ;;
esac

# --------------------------------------------------------------------------- #
#  3. Cài Node.js v${NODE_VERSION} và đặt LÀM MẬĐỊNH
# --------------------------------------------------------------------------- #
install_node() {
  if command -v node >/dev/null 2>&1 && [[ "$(node -v 2>/dev/null)" == v${NODE_VERSION}.* ]]; then
    log "Đã có Node $(node -v) - bỏ qua cài Node."; return 0
  fi

  # Cách 1: NodeSource -> cài toàn hệ thống, làm mặc định thật sự (apt/dnf/yum)
  case "$PKG" in
    apt-get)
      log "Cài Node v${NODE_VERSION} qua NodeSource (apt)"
      if fetch "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | $SUDO -E bash - ; then
        pkg_install nodejs && return 0
      fi
      warn "NodeSource thất bại, chuyển sang nvm." ;;
    dnf|yum)
      log "Cài Node v${NODE_VERSION} qua NodeSource (rpm)"
      if fetch "https://rpm.nodesource.com/setup_${NODE_VERSION}.x" | $SUDO -E bash - ; then
        pkg_install nodejs && return 0
      fi
      warn "NodeSource thất bại, chuyển sang nvm." ;;
  esac

  # Cách 2: nvm + symlink ra /usr/local/bin (mọi shell đều thấy - hữu ích trên Colab)
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -s "$NVM_DIR/nvm.sh" ]] || { log "Cài nvm..."; fetch https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || warn "Không cài được nvm."; }
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "$NVM_DIR/nvm.sh"
    log "Cài Node v${NODE_VERSION} và đặt mặc định qua nvm"
    nvm install "${NODE_VERSION}"; nvm alias default "${NODE_VERSION}"; nvm use default
    local nbin; nbin="$(dirname "$(nvm which "${NODE_VERSION}")")"
    for b in node npm npx; do
      [[ -x "$nbin/$b" ]] && { $SUDO ln -sf "$nbin/$b" /usr/local/bin/$b 2>/dev/null || ln -sf "$nbin/$b" /usr/local/bin/$b 2>/dev/null || true; }
    done
  else
    case "$PKG" in pacman|zypper) pkg_install nodejs npm ;; esac
  fi
}

install_node
command -v node >/dev/null 2>&1 || die "Không cài được Node.js."
log "Node: $(node -v) | npm: $(npm -v 2>/dev/null || echo '?')"

# --------------------------------------------------------------------------- #
#  4. Tạo dự án Node + cài Playwright & Patchright (npm)
# --------------------------------------------------------------------------- #
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
log "Dự án Node tại: $PROJECT_DIR"
[[ -f package.json ]] || npm init -y >/dev/null 2>&1

log "Cài playwright + patchright (npm)"
npm install --no-fund --no-audit playwright patchright

# Tải trình duyệt cho cả hai (yes '' tự gửi Enter nếu còn prompt sót)
for engine in $BROWSERS; do
  log "Tải trình duyệt cho Playwright: $engine"
  npx --yes playwright install "$engine"
  log "Tải trình duyệt cho Patchright: $engine"
  npx --yes patchright install "$engine"
done

if [[ "$INSTALL_OS_DEPS" == "1" && "$PKG" == "apt-get" ]]; then
  log "Cài dependencies hệ điều hành cho trình duyệt (non-interactive)"
  $SUDO env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
    npx --yes playwright install-deps || warn "install-deps lỗi (có thể thiếu quyền). Bỏ qua."
else
  [[ "$INSTALL_OS_DEPS" == "1" ]] && warn "Bỏ qua install-deps (chỉ apt hỗ trợ tự động)."
fi

# --------------------------------------------------------------------------- #
#  5. Helper chạy HEADFUL trong màn hình ảo Xvfb (giải pháp 'không headless')
# --------------------------------------------------------------------------- #
cat > "$PROJECT_DIR/run-stealth.sh" <<'EOF'
#!/usr/bin/env bash
# Chạy script Node Patchright ở chế độ HEADFUL trong màn hình ảo Xvfb.
#   ./run-stealth.sh example_patchright.js [args...]
set -Eeuo pipefail
if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a --server-args="-screen 0 1920x1080x24" node "$@"
else
  echo "[run-stealth] Không có xvfb-run, chạy trực tiếp (cần có DISPLAY)." >&2
  exec node "$@"
fi
EOF
chmod +x "$PROJECT_DIR/run-stealth.sh"

# --------------------------------------------------------------------------- #
#  6. File ví dụ Patchright cho Node (headful, đúng cách khuyến nghị)
# --------------------------------------------------------------------------- #
cat > "$PROJECT_DIR/example_patchright.js" <<'EOF'
// Ví dụ Patchright (Node.js) đúng chuẩn tàng hình: headful + Xvfb.
// Chạy:  ./run-stealth.sh example_patchright.js
const { chromium } = require("patchright");

(async () => {
  // KHÔNG dùng headless: true với patchright. Dùng headless: false + Xvfb.
  const context = await chromium.launchPersistentContext("./.pw-profile", {
    channel: "chrome",        // dùng Chrome thật nếu có; bỏ nếu chỉ có chromium
    headless: false,
    viewport: null,
    args: ["--start-maximized"],
  });
  const page = await context.newPage();
  await page.goto("https://bot.sannysoft.com/", { waitUntil: "load" });
  await page.screenshot({ path: "stealth_check.png", fullPage: true });
  console.log("Đã chụp stealth_check.png — các dòng đều xanh là OK.");
  await context.close();
})();
EOF

# --------------------------------------------------------------------------- #
#  7. Kiểm tra nhanh + tổng kết
# --------------------------------------------------------------------------- #
log "Phiên bản đã cài:"
node -e 'const p=require("./package.json").dependencies||{}; for(const k of ["playwright","patchright"]){try{console.log("  - "+k+": "+require(k+"/package.json").version)}catch(e){console.log("  - "+k+": ("+(p[k]||"?")+")")}}' || true

cat <<EOF

$LOG_PREFIX ✅ HOÀN TẤT.
$LOG_PREFIX -------------------------------------------------------------
$LOG_PREFIX Node.js    : $(node -v)   (mặc định)
$LOG_PREFIX npm        : $(npm -v 2>/dev/null || echo '?')
$LOG_PREFIX Dự án      : $PROJECT_DIR
$LOG_PREFIX Trình duyệt: $BROWSERS
$LOG_PREFIX
$LOG_PREFIX ▶ Chạy bot patchright KHÔNG headless (qua Xvfb):
$LOG_PREFIX     cd "$PROJECT_DIR" && ./run-stealth.sh example_patchright.js
$LOG_PREFIX
$LOG_PREFIX ▶ Quan trọng: với patchright dùng headless:false (đừng dùng hidden/headless).
$LOG_PREFIX -------------------------------------------------------------
EOF

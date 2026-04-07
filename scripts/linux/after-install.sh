#!/bin/bash

# Post-installation script for Deep AI Worker on Linux

set -e

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database -q /usr/share/applications || true
fi

# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi

APP_ROOT=""
for candidate in "/opt/Deep AI Worker" "/opt/ClawX"; do
    if [ -d "$candidate" ]; then
        APP_ROOT="$candidate"
        break
    fi
done

APP_EXEC=""
for candidate in "$APP_ROOT/deep-ai-worker" "$APP_ROOT/Deep AI Worker" "$APP_ROOT/clawx"; do
    if [ -n "$APP_ROOT" ] && [ -x "$candidate" ]; then
        APP_EXEC="$candidate"
        break
    fi
done

# Create symbolic links for the app binary
if [ -n "$APP_EXEC" ]; then
    ln -sf "$APP_EXEC" /usr/local/bin/deep-ai-worker 2>/dev/null || true
    ln -sf "$APP_EXEC" /usr/local/bin/clawx 2>/dev/null || true
fi

# Create symbolic link for openclaw CLI
OPENCLAW_WRAPPER=""
for candidate in "$APP_ROOT/resources/cli/openclaw" "/opt/Deep AI Worker/resources/cli/openclaw" "/opt/ClawX/resources/cli/openclaw"; do
    if [ -f "$candidate" ]; then
        OPENCLAW_WRAPPER="$candidate"
        break
    fi
done
if [ -n "$OPENCLAW_WRAPPER" ] && [ -f "$OPENCLAW_WRAPPER" ]; then
    chmod +x "$OPENCLAW_WRAPPER" 2>/dev/null || true
    ln -sf "$OPENCLAW_WRAPPER" /usr/local/bin/openclaw 2>/dev/null || true
fi

# Set chrome-sandbox permissions.
# On systems without working user namespaces, the SUID bit is required.
# On Ubuntu 24.04+, user namespaces are available but blocked by AppArmor;
# we rely on the AppArmor profile below instead, so 0755 is correct there.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # No user namespace support — fall back to SUID sandbox
    [ -n "$APP_ROOT" ] && chmod 4755 "$APP_ROOT/chrome-sandbox" || true
else
    [ -n "$APP_ROOT" ] && chmod 0755 "$APP_ROOT/chrome-sandbox" || true
fi

# Install AppArmor profile (Ubuntu 24.04+).
# Ubuntu 24.04 enables kernel.apparmor_restrict_unprivileged_userns=1 by default,
# which blocks Electron's sandbox. The bundled AppArmor profile grants the 'userns'
# permission so the app can create user namespaces without disabling the global policy.
#
# We first check if AppArmor is enabled and if the running version supports abi/4.0
# (Ubuntu 22.04 does not; it runs fine without the profile, so we skip it there).
if apparmor_status --enabled > /dev/null 2>&1; then
    APPARMOR_PROFILE_SOURCE="$APP_ROOT/resources/apparmor-profile"
    APPARMOR_PROFILE_TARGET='/etc/apparmor.d/clawx'
    if [ -n "$APP_ROOT" ] && [ -f "$APPARMOR_PROFILE_SOURCE" ] && apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
        cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

        # Skip live-loading in a chroot environment (e.g. image-building pipelines).
        if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
        fi
    else
        echo "Skipping AppArmor profile installation: this version of AppArmor does not support the bundled profile"
    fi
fi

echo "Deep AI Worker has been installed successfully."

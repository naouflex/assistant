import type { MenuAction, MenuComponentProps, MenuComponentRef } from "@expo/ui/community/menu";
import {
  Text as ComposeText,
  DropdownMenu,
  DropdownMenuItem,
  HorizontalDivider,
  Host,
  Icon,
  RNHostView,
} from "@expo/ui/jetpack-compose";
import type { Ref } from "react";
import { useCallback, useImperativeHandle, useRef, useState } from "react";
import type { ColorValue } from "react-native";
import { Pressable, View } from "react-native";
import { useMobileTokens } from "../lib/native";

// Clipped popups drop the status bar offset, so a menu near the screen edge detaches from its button.
const POPUP_PROPERTIES = { clippingEnabled: false };

function actionId(action: MenuAction): string {
  return action.id ?? action.title;
}

function colorString(color: ColorValue | undefined, fallback: string): string {
  return typeof color === "string" ? color : fallback;
}

type ItemColors = { text: string; disabled: string; destructive: string };

function MenuActionItem({
  action,
  colors,
  onPressAction,
  dismissAll,
}: {
  action: MenuAction;
  colors: ItemColors;
  onPressAction: MenuComponentProps["onPressAction"];
  dismissAll: () => void;
}) {
  const [submenuExpanded, setSubmenuExpanded] = useState(false);
  if (action.attributes?.hidden) return null;

  const { subactions, displayInline, state, attributes, title, image, imageColor } = action;
  const destructive = action.attributes?.destructive === true;
  const textColor = colorString(action.titleColor, destructive ? colors.destructive : colors.text);
  const iconTint = colorString(imageColor, textColor);
  // A string image is an iOS symbol. Android only draws a required image asset.
  const leadingIconSource = typeof image === "string" || image == null ? null : image;
  const elementColors = {
    textColor,
    disabledTextColor: colors.disabled,
    leadingIconColor: iconTint,
    disabledLeadingIconColor: colors.disabled,
  };

  if (subactions && subactions.length > 0) {
    if (displayInline) {
      return (
        <>
          <HorizontalDivider color={colors.disabled} />
          {subactions.map((sub) => (
            <MenuActionItem
              key={actionId(sub)}
              action={sub}
              colors={colors}
              onPressAction={onPressAction}
              dismissAll={dismissAll}
            />
          ))}
          <HorizontalDivider color={colors.disabled} />
        </>
      );
    }
    return (
      <DropdownMenu
        expanded={submenuExpanded}
        onDismissRequest={() => setSubmenuExpanded(false)}
        properties={POPUP_PROPERTIES}
      >
        <DropdownMenu.Trigger>
          <DropdownMenuItem
            enabled={!attributes?.disabled}
            elementColors={elementColors}
            onClick={() => setSubmenuExpanded(true)}
          >
            <DropdownMenuItem.Text>
              <ComposeText color={textColor}>{title}</ComposeText>
            </DropdownMenuItem.Text>
            {leadingIconSource ? (
              <DropdownMenuItem.LeadingIcon>
                <Icon source={leadingIconSource} size={24} tint={iconTint} />
              </DropdownMenuItem.LeadingIcon>
            ) : null}
          </DropdownMenuItem>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {subactions.map((sub) => (
            <MenuActionItem
              key={actionId(sub)}
              action={sub}
              colors={colors}
              onPressAction={onPressAction}
              dismissAll={() => {
                setSubmenuExpanded(false);
                dismissAll();
              }}
            />
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenuItem
      enabled={!attributes?.disabled}
      elementColors={elementColors}
      onClick={() => {
        onPressAction?.({ nativeEvent: { event: actionId(action) } });
        dismissAll();
      }}
    >
      <DropdownMenuItem.Text>
        <ComposeText color={textColor}>{title}</ComposeText>
      </DropdownMenuItem.Text>
      {leadingIconSource ? (
        <DropdownMenuItem.LeadingIcon>
          <Icon source={leadingIconSource} size={24} tint={iconTint} />
        </DropdownMenuItem.LeadingIcon>
      ) : null}
      {state === "on" ? (
        <DropdownMenuItem.TrailingIcon>
          <ComposeText color={textColor}>✓</ComposeText>
        </DropdownMenuItem.TrailingIcon>
      ) : null}
    </DropdownMenuItem>
  );
}

/**
 * Android menus from the shared menu view follow the wallpaper's Material colors, so
 * labels and icons clash with the monochrome app. This one uses the app's popover colors.
 */
export function MenuView(props: MenuComponentProps & { ref?: Ref<MenuComponentRef> }) {
  const {
    ref,
    actions,
    colorScheme,
    onPressAction,
    onOpenMenu,
    onCloseMenu,
    shouldOpenOnLongPress,
    style,
    children,
    testID,
  } = props;
  const tokens = useMobileTokens();
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const colors: ItemColors = {
    text: tokens.popoverForeground,
    disabled: tokens.mutedForeground,
    destructive: tokens.destructive,
  };

  const open = useCallback(() => {
    if (expandedRef.current) return;
    expandedRef.current = true;
    setExpanded(true);
    onOpenMenu?.();
  }, [onOpenMenu]);

  const dismissAll = useCallback(() => {
    if (!expandedRef.current) return;
    expandedRef.current = false;
    setExpanded(false);
    onCloseMenu?.();
  }, [onCloseMenu]);

  useImperativeHandle(ref, () => ({ show: open }), [open]);

  return (
    <View style={style} testID={testID}>
      <Host colorScheme={colorScheme} matchContents seedColor={tokens.foreground}>
        <DropdownMenu
          color={tokens.popover}
          expanded={expanded}
          onDismissRequest={dismissAll}
          properties={POPUP_PROPERTIES}
        >
          <DropdownMenu.Trigger>
            <RNHostView matchContents>
              <Pressable
                onPress={shouldOpenOnLongPress ? undefined : open}
                onLongPress={shouldOpenOnLongPress ? open : undefined}
                android_disableSound
                focusable={false}
                accessible={false}
              >
                {children}
              </Pressable>
            </RNHostView>
          </DropdownMenu.Trigger>
          <DropdownMenu.Items>
            {actions.map((action) => (
              <MenuActionItem
                key={actionId(action)}
                action={action}
                colors={colors}
                onPressAction={onPressAction}
                dismissAll={dismissAll}
              />
            ))}
          </DropdownMenu.Items>
        </DropdownMenu>
      </Host>
    </View>
  );
}

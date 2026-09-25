import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import Header from "./Header";
import "./StorefrontFrame.css";

const PRIMARY_A =
  "M0 0V324.8C120.0 433.1 253.3 460.1 400.0 406.0C546.7 351.9 680.0 340.3 800.0 371.2C920.0 402.1 1053.3 394.4 1200.0 348.0C1320.0 309.3 1400.0 270.7 1440 232.0V0H0Z";
const PRIMARY_B =
  "M0 0V350.0C160.0 395.0 310.0 420.0 450.0 375.0C600.0 388.0 730.0 380.0 850.0 410.0C970.0 365.0 1110.0 355.0 1240.0 320.0C1350.0 338.0 1425.0 300.0 1440 258.0V0H0Z";
const PRIMARY_C =
  "M0 0V300.0C80.0 455.0 200.0 485.0 350.0 430.0C500.0 318.0 630.0 305.0 750.0 335.0C870.0 435.0 1000.0 428.0 1150.0 378.0C1280.0 278.0 1375.0 240.0 1440 206.0V0H0Z";
const SECONDARY_A =
  "M0 0V335.8C132.0 445.1 268.0 469.1 412.0 395.0C536.0 339.9 668.0 351.3 788.0 384.2C934.0 413.1 1066.0 383.4 1188.0 335.0C1310.0 320.3 1392.0 283.7 1440 241.0V0H0Z";
const SECONDARY_B =
  "M0 0V312.0C90.0 415.0 220.0 438.0 370.0 420.0C580.0 370.0 715.0 385.0 835.0 415.0C880.0 380.0 1015.0 350.0 1230.0 310.0C1345.0 345.0 1420.0 310.0 1440 265.0V0H0Z";
const SECONDARY_C =
  "M0 0V360.0C175.0 475.0 315.0 495.0 455.0 370.0C490.0 310.0 620.0 320.0 740.0 355.0C980.0 445.0 1115.0 415.0 1145.0 360.0C1270.0 295.0 1365.0 255.0 1440 218.0V0H0Z";

interface StorefrontFrameProps {
  children: ReactNode;
  className?: string;
  headerVariant?: "storefront" | "admin";
}

export default function StorefrontFrame({
  children,
  className = "",
  headerVariant = "storefront",
}: StorefrontFrameProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={`storefront-frame ${className}`.trim()}>
      <div className="storefront-frame__wave" aria-hidden="true">
        <svg
          viewBox="0 0 1440 434"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <motion.path
            className="wave-secondary"
            d={SECONDARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    d: [SECONDARY_A, SECONDARY_B, SECONDARY_C],
                    x: [-12, 4, 14],
                    y: [-4, 2, 5],
                  }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 7,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
          <motion.path
            className="wave-primary"
            d={PRIMARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    d: [PRIMARY_A, PRIMARY_B, PRIMARY_C],
                    y: [-3, 1, 3],
                  }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 5,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
        </svg>
      </div>

      <Header variant={headerVariant} />
      <div className="storefront-frame__scroll">{children}</div>
    </div>
  );
}

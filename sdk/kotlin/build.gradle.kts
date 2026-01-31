plugins {
    kotlin("jvm") version "1.9.22"
    `maven-publish`
    `java-library`
}

group = "com.privacyrpc"
version = "1.0.0"

repositories {
    mavenCentral()
    google()
}

dependencies {
    // Kotlin
    implementation(kotlin("stdlib"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")

    // JSON parsing
    implementation("org.json:json:20231013")

    // Testing
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.1")
    testImplementation("io.mockk:mockk:1.13.8")
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
    withSourcesJar()
    withJavadocJar()
}

kotlin {
    jvmToolchain(21)
}

tasks.test {
    useJUnitPlatform()
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = "com.privacyrpc"
            artifactId = "privacyrpc-sdk"
            version = project.version.toString()

            from(components["java"])

            pom {
                name.set("PrivacyRPC SDK")
                description.set("Secure RPC proxy and blockchain protection SDK")
                url.set("https://github.com/privacyrpc/sdk")

                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }

                developers {
                    developer {
                        id.set("privacyrpc")
                        name.set("PrivacyRPC Team")
                    }
                }
            }
        }
    }
}
